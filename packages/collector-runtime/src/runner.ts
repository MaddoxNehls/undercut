import type { JobResult, LeasedJob } from '@undercut/core';
import type { BrowserContext } from 'playwright';
import { CollectorApiError, type CollectorServer } from './api-client';
import { capture, type CaptureOptions } from './capture';
import { RobotsCache, RobotsUnavailableError } from './robots';

export type LogFn = (message: string, fields?: Record<string, unknown>) => void;

export interface RunnerOptions {
  server: CollectorServer;
  context: BrowserContext;
  /** Parallel page loads. Politeness is enforced server-side per domain; this caps local load. */
  concurrency?: number;
  /** Long-poll duration per lease request. */
  waitMs?: number;
  heartbeatMs?: number;
  /**
   * Exit once a lease long-poll comes back empty instead of polling forever (cron-style runs,
   * smoke tests). The long-poll also waits out per-domain politeness delays.
   */
  once?: boolean;
  /** Global robots.txt switch; a job can additionally opt out per domain. */
  respectRobots?: boolean;
  robots?: RobotsCache;
  capture?: CaptureOptions;
  version: string;
  hostname?: string;
  signal?: AbortSignal;
  log?: LogFn;
}

export interface RunStats {
  processed: number;
  ok: number;
  blocked: number;
  parseErrors: number;
  errors: number;
  skipped: number;
  leaseLost: number;
}

const RETRY_DELAY_MS = 5_000;

/**
 * The collector main loop, shared by the cloud worker and the local CLI: lease a job
 * (long-poll), check robots.txt, capture the page, report the result. Heartbeats run alongside
 * and extend the leases of in-flight jobs.
 */
export async function runCollector(options: RunnerOptions): Promise<RunStats> {
  const { server, context, signal } = options;
  const log: LogFn = options.log ?? (() => {});
  const robots = options.robots ?? new RobotsCache();
  const waitMs = options.waitMs ?? (options.once ? 10_000 : 25_000);
  const stats: RunStats = { processed: 0, ok: 0, blocked: 0, parseErrors: 0, errors: 0, skipped: 0, leaseLost: 0 };
  const active = new Set<string>();

  const beat = async (): Promise<void> => {
    try {
      await server.heartbeat({ version: options.version, hostname: options.hostname, activeLeaseIds: [...active] });
    } catch (err) {
      log('heartbeat failed', { error: describe(err) });
    }
  };
  await beat();
  const heartbeat = setInterval(() => void beat(), options.heartbeatMs ?? 30_000);

  const handle = async (job: LeasedJob): Promise<void> => {
    active.add(job.leaseId);
    try {
      const result = await collect(job);
      tally(stats, result);
      log(`job ${job.jobId.slice(0, 8)} ${result.status}`, summarize(job, result));
      await server.submit(job.jobId, result);
    } catch (err) {
      if (err instanceof CollectorApiError && err.code === 'lease_lost') {
        stats.leaseLost++;
        log('lease lost; result discarded', { jobId: job.jobId });
      } else {
        log('submitting result failed', { jobId: job.jobId, error: describe(err) });
      }
    } finally {
      active.delete(job.leaseId);
    }
  };

  const collect = async (job: LeasedJob): Promise<JobResult> => {
    if (options.respectRobots !== false && job.respectRobots) {
      try {
        if (!(await robots.isAllowed(job.url))) {
          return { status: 'skipped', leaseId: job.leaseId, reason: 'robots.txt disallows this URL' };
        }
      } catch (err) {
        if (err instanceof RobotsUnavailableError) return { status: 'error', leaseId: job.leaseId, error: err.message };
        throw err;
      }
    }
    return capture(context, job, options.capture);
  };

  const slot = async (): Promise<void> => {
    while (!signal?.aborted) {
      let job: LeasedJob | null;
      try {
        job = await server.lease(waitMs, signal);
      } catch (err) {
        if (signal?.aborted) return;
        log('lease request failed; retrying', { error: describe(err) });
        await sleep(RETRY_DELAY_MS, signal);
        continue;
      }
      if (job) await handle(job);
      else if (options.once) return;
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 1) }, slot));
  } finally {
    clearInterval(heartbeat);
  }
  return stats;
}

function tally(stats: RunStats, result: JobResult): void {
  stats.processed++;
  if (result.status === 'ok') stats.ok++;
  else if (result.status === 'blocked') stats.blocked++;
  else if (result.status === 'parse_error') stats.parseErrors++;
  else if (result.status === 'error') stats.errors++;
  else stats.skipped++;
}

function summarize(job: LeasedJob, result: JobResult): Record<string, unknown> {
  const base = { url: job.url, probe: job.isProbe || undefined };
  switch (result.status) {
    case 'ok':
      return { ...base, price: result.price.amount, currency: result.price.currency };
    case 'blocked':
    case 'parse_error':
    case 'skipped':
      return { ...base, reason: result.reason };
    case 'error':
      return { ...base, error: result.error };
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
