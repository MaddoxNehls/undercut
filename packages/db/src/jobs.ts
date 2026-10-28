import {
  DEFAULT_ROUTING,
  nextRoute,
  type CollectorKind,
  type ExtractionRule,
  type JobResult,
  type LeasedJob,
  type ObservationHook,
  type ObservationRecorded,
  type ObservationStatus,
  type RoutingConfig,
} from '@undercut/core';
import { inTransaction, toJson, type Db } from './client';
import type { Collector, Job } from './types';

export const DEFAULT_LEASE_SECONDS = 120;

type LeaseRow = {
  id: string;
  leaseId: string;
  leaseExpiresAt: Date;
  url: string;
  domain: string;
  isProbe: boolean;
  extraction: ExtractionRule;
  currency: string | null;
  locale: string | null;
  respectRobots: boolean;
};

/**
 * Leases the oldest runnable job for this collector's kind, or returns null.
 *
 * Correctness under concurrency comes from one statement:
 *  - `FOR UPDATE OF j, d SKIP LOCKED` locks the job AND its domain row. A competing collector
 *    skips both instead of waiting, so no job is handed out twice, and two collectors can't
 *    both decide a domain still has politeness budget left.
 *  - An expired lease is simply leasable again (`attempts` counts tries); no reaper is needed
 *    for jobs to recover from a crashed collector.
 *  - A fresh `lease_id` fences out the previous holder: its late result will be rejected.
 */
export async function leaseJob(db: Db, collector: Pick<Collector, 'id' | 'kind'>, leaseSeconds = DEFAULT_LEASE_SECONDS): Promise<LeasedJob | null> {
  const [row] = await db<LeaseRow[]>`
    WITH candidate AS (
      SELECT j.id
      FROM jobs j
      JOIN domains d ON d.domain = j.domain
      WHERE j.route = ${collector.kind}
        AND j.attempts < j.max_attempts
        AND j.not_before <= now()
        AND (j.status = 'queued' OR (j.status = 'leased' AND j.lease_expires_at < now()))
        AND (d.last_dispatched_at IS NULL
             OR d.last_dispatched_at <= now() - d.min_interval_ms * interval '1 millisecond')
        AND (SELECT count(*) FROM jobs a
             WHERE a.domain = j.domain AND a.status = 'leased' AND a.lease_expires_at >= now()) < d.max_concurrency
      ORDER BY j.scheduled_for, j.created_at
      LIMIT 1
      FOR UPDATE OF j, d SKIP LOCKED
    ),
    leased AS (
      UPDATE jobs SET
        status = 'leased',
        lease_id = gen_random_uuid(),
        leased_by = ${collector.id},
        lease_expires_at = now() + ${leaseSeconds}::int * interval '1 second',
        attempts = jobs.attempts + 1
      FROM candidate
      WHERE jobs.id = candidate.id
      RETURNING jobs.*
    ),
    dispatched AS (
      UPDATE domains SET last_dispatched_at = now() FROM leased WHERE domains.domain = leased.domain
    )
    SELECT l.id, l.lease_id, l.lease_expires_at, l.url, l.domain, l.is_probe,
           w.extraction, w.currency, w.locale, d.respect_robots
    FROM leased l
    JOIN watch_variants v ON v.id = l.variant_id
    JOIN watches w ON w.id = v.watch_id
    JOIN domains d ON d.domain = l.domain`;

  if (!row) return null;
  return {
    jobId: row.id,
    leaseId: row.leaseId,
    leaseExpiresAt: row.leaseExpiresAt.toISOString(),
    url: row.url,
    domain: row.domain,
    isProbe: row.isProbe,
    extraction: row.extraction,
    parse: {
      ...(row.locale ? { locale: row.locale } : {}),
      ...(row.currency ? { currency: row.currency } : {}),
    },
    respectRobots: row.respectRobots,
  };
}

/** Long-poll: retries `leaseJob` until a job appears, `waitMs` elapses, or the caller aborts. */
export async function waitForLease(
  db: Db,
  collector: Pick<Collector, 'id' | 'kind'>,
  options: { waitMs: number; pollMs?: number; leaseSeconds?: number; signal?: AbortSignal },
): Promise<LeasedJob | null> {
  const deadline = Date.now() + options.waitMs;
  const pollMs = options.pollMs ?? 1000;
  for (;;) {
    const job = await leaseJob(db, collector, options.leaseSeconds);
    if (job || Date.now() + pollMs > deadline || options.signal?.aborted) return job;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export class JobNotFoundError extends Error {
  readonly code = 'job_not_found';
}

/** The caller's lease is no longer current: it expired and someone else took the job. */
export class LeaseLostError extends Error {
  readonly code = 'lease_lost';
}

export interface SubmitOutcome {
  accepted: true;
  observationId: string | null;
  /** True when this exact result had already been recorded (a retried HTTP request). */
  duplicate: boolean;
}

type LockedJob = Job & { watchId: string };

/**
 * Records a collector's result for a leased job, exactly once.
 *
 * At-least-once collection, exactly-once recording: a job may be attempted several times
 * (expired leases, retries), but only the current lease holder may complete it, observations are
 * unique per job, and replaying an already-accepted result is a harmless no-op.
 */
export async function submitResult(
  db: Db,
  collector: Pick<Collector, 'id' | 'kind'>,
  jobId: string,
  result: JobResult,
  options: { hooks?: readonly ObservationHook[]; routing?: RoutingConfig; onHookError?: (hook: string, err: unknown) => void } = {},
): Promise<SubmitOutcome> {
  const { outcome, event } = await inTransaction(db, async (tx) => {
    const [job] = await tx<LockedJob[]>`
      SELECT j.*, v.watch_id FROM jobs j JOIN watch_variants v ON v.id = j.variant_id
      WHERE j.id = ${jobId} FOR UPDATE OF j`;
    if (!job) throw new JobNotFoundError(`job ${jobId} not found`);

    if (job.leaseId !== result.leaseId || job.leasedBy !== collector.id) {
      throw new LeaseLostError(`lease ${result.leaseId} is no longer current for job ${jobId}`);
    }
    if (job.status !== 'leased') {
      const [existing] = await tx<{ id: string }[]>`SELECT id FROM observations WHERE job_id = ${jobId}`;
      return { outcome: { accepted: true, observationId: existing?.id ?? null, duplicate: true } as const, event: null };
    }

    switch (result.status) {
      case 'error': {
        const exhausted = job.attempts >= job.maxAttempts;
        // Exponential backoff: 30s, 60s, 120s... capped at 30 minutes.
        const backoffSeconds = Math.min(30 * 2 ** (job.attempts - 1), 1800);
        await tx`
          UPDATE jobs SET
            status = ${exhausted ? 'failed' : 'queued'},
            last_error = ${result.error},
            lease_id = NULL, leased_by = NULL, lease_expires_at = NULL,
            not_before = now() + ${backoffSeconds}::int * interval '1 second',
            completed_at = ${exhausted ? tx`now()` : null}
          WHERE id = ${jobId}`;
        return { outcome: { accepted: true, observationId: null, duplicate: false } as const, event: null };
      }
      case 'skipped': {
        await tx`UPDATE jobs SET status = 'skipped', last_error = ${result.reason}, completed_at = now() WHERE id = ${jobId}`;
        return { outcome: { accepted: true, observationId: null, duplicate: false } as const, event: null };
      }
      default: {
        const observationId = await recordObservation(tx, job, collector.kind, result);
        await tx`UPDATE jobs SET status = 'done', completed_at = now(), last_error = NULL WHERE id = ${jobId}`;
        await bumpDomainStats(tx, job.domain, collector.kind, result.status);
        await reevaluateRoute(tx, job.domain, options.routing ?? DEFAULT_ROUTING);
        const recorded: ObservationRecorded = {
          observationId,
          watchId: job.watchId,
          variantId: job.variantId,
          status: result.status,
          price: result.status === 'ok' ? result.price.amount : null,
          currency: result.status === 'ok' ? result.price.currency : null,
          asOf: new Date(result.asOf),
          collectorKind: collector.kind,
        };
        return { outcome: { accepted: true, observationId, duplicate: false } as const, event: recorded };
      }
    }
  });

  // Hooks run after commit: an alerting failure must never roll back or duplicate data.
  if (event) {
    for (const hook of options.hooks ?? []) {
      await hook.onObservation(event).catch((err: unknown) => options.onHookError?.(hook.name, err));
    }
  }
  return outcome;
}

type ObservationResult = Extract<JobResult, { status: ObservationStatus }>;

async function recordObservation(tx: Db, job: LockedJob, kind: CollectorKind, result: ObservationResult): Promise<string> {
  const price = result.status === 'ok' ? result.price : null;
  const reason = result.status === 'ok' ? null : result.reason;
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO observations (
      job_id, variant_id, domain, collector_id, collector_kind, is_probe, status,
      price, currency, price_kind, price_max, period, reason, raw_snippet,
      http_status, final_url, duration_ms, as_of, healing
    ) VALUES (
      ${job.id}, ${job.variantId}, ${job.domain}, ${job.leasedBy}, ${kind}, ${job.isProbe}, ${result.status},
      ${price?.amount ?? null}, ${price?.currency ?? null}, ${price?.kind ?? null}, ${price?.max ?? null},
      ${price?.period ?? null}, ${reason}, ${result.snippet},
      ${result.httpStatus}, ${result.finalUrl}, ${result.durationMs}, ${result.asOf},
      ${result.status === 'parse_error' && result.healing ? tx.json(toJson(result.healing)) : null}
    )
    RETURNING id`;
  if (!row) throw new Error('observation insert returned no row');
  return row.id;
}

async function bumpDomainStats(tx: Db, domain: string, kind: CollectorKind, status: ObservationStatus): Promise<void> {
  await tx`
    INSERT INTO domain_stats (domain, collector_kind, attempts, ok, blocked, parse_errors, last_attempt_at, last_blocked_at)
    VALUES (${domain}, ${kind}, 1,
            ${status === 'ok' ? 1 : 0}, ${status === 'blocked' ? 1 : 0}, ${status === 'parse_error' ? 1 : 0},
            now(), ${status === 'blocked' ? tx`now()` : null})
    ON CONFLICT (domain, collector_kind) DO UPDATE SET
      attempts = domain_stats.attempts + 1,
      ok = domain_stats.ok + EXCLUDED.ok,
      blocked = domain_stats.blocked + EXCLUDED.blocked,
      parse_errors = domain_stats.parse_errors + EXCLUDED.parse_errors,
      last_attempt_at = now(),
      last_blocked_at = COALESCE(EXCLUDED.last_blocked_at, domain_stats.last_blocked_at)`;
}

/** Applies the routing policy to the domain's latest cloud evidence. Runs inside the result transaction. */
export async function reevaluateRoute(tx: Db, domain: string, config: RoutingConfig): Promise<void> {
  const [state] = await tx<{ route: CollectorKind; routeChangedAt: Date; lastProbeAt: Date | null }[]>`
    SELECT route, route_changed_at, last_probe_at FROM domains WHERE domain = ${domain} FOR UPDATE`;
  if (!state) return;
  // Server-side recorded_at, not the collector's clock, orders the evidence.
  const attempts = await tx<{ status: ObservationStatus; at: Date }[]>`
    SELECT status, recorded_at AS at FROM observations
    WHERE domain = ${domain} AND collector_kind = 'cloud'
    ORDER BY recorded_at DESC LIMIT ${config.window}`;

  const transition = nextRoute({ route: state.route, changedAt: state.routeChangedAt, lastProbeAt: state.lastProbeAt }, attempts, config);
  if (transition) {
    await tx`
      UPDATE domains SET route = ${transition.route}, route_reason = ${transition.reason},
             route_changed_at = now(), last_probe_at = NULL
      WHERE domain = ${domain}`;
  }
}

/** "Check now": queues an immediate job per variant, unless one is already outstanding. */
export async function enqueueNow(db: Db, watchId: string, now = new Date()): Promise<number> {
  const rows = await db`
    INSERT INTO jobs (variant_id, domain, url, route, idempotency_key, scheduled_for)
    SELECT v.id, w.domain, COALESCE(v.url, w.url),
           CASE WHEN w.route_override = 'auto' THEN d.route ELSE w.route_override END,
           v.id || ':manual:' || ${Math.floor(now.getTime() / 1000)}, ${now}
    FROM watch_variants v
    JOIN watches w ON w.id = v.watch_id
    JOIN domains d ON d.domain = w.domain
    WHERE w.id = ${watchId}
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return rows.length;
}

export interface JobSummary {
  id: string;
  status: Job['status'];
  route: CollectorKind;
  isProbe: boolean;
  attempts: number;
  scheduledFor: Date;
  lastError: string | null;
  leaseExpiresAt: Date | null;
  collectorName: string | null;
}

export async function listRecentJobs(db: Db, watchId: string, limit = 20): Promise<JobSummary[]> {
  return db<JobSummary[]>`
    SELECT j.id, j.status, j.route, j.is_probe, j.attempts, j.scheduled_for, j.last_error, j.lease_expires_at,
           c.name AS collector_name
    FROM jobs j
    JOIN watch_variants v ON v.id = j.variant_id
    LEFT JOIN collectors c ON c.id = j.leased_by
    WHERE v.watch_id = ${watchId}
    ORDER BY j.created_at DESC
    LIMIT ${limit}`;
}
