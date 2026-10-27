import { DEFAULT_ROUTING, isProbeDue, type CollectorKind, type RoutingConfig } from '@undercut/core';
import type { Db } from './client';

export interface TickResult {
  scheduled: number;
  probes: number;
  rerouted: number;
  failed: number;
}

/**
 * One scheduler pass. Safe to run concurrently or repeatedly (cron retries, two instances):
 * every write is either idempotent or guarded by a unique index.
 *
 *  1. Fail jobs whose last allowed lease expired.
 *  2. Create one job per active variant for its current slot. The idempotency key
 *     `${variant}:${slotEpoch}` makes this a no-op if the slot already has a job, and the
 *     one-outstanding-job index skips variants whose previous job is still waiting.
 *  3. Move queued jobs whose domain's learned route changed since they were created.
 *  4. Send a shadow cloud probe for locally-routed domains that are due for one.
 */
export async function schedulerTick(db: Db, now: Date = new Date(), routing: RoutingConfig = DEFAULT_ROUTING): Promise<TickResult> {
  const failed = await db`
    UPDATE jobs SET status = 'failed', completed_at = now(),
           last_error = COALESCE(last_error, 'lease expired on the final attempt')
    WHERE status = 'leased' AND lease_expires_at < now() AND attempts >= max_attempts
    RETURNING id`;

  const scheduled = await db`
    INSERT INTO jobs (variant_id, domain, url, route, idempotency_key, scheduled_for)
    SELECT v.id, w.domain, COALESCE(v.url, w.url),
           CASE WHEN w.route_override = 'auto' THEN d.route ELSE w.route_override END,
           v.id || ':' || slot.epoch, to_timestamp(slot.epoch)
    FROM watch_variants v
    JOIN watches w ON w.id = v.watch_id AND w.active
    JOIN domains d ON d.domain = w.domain
    CROSS JOIN LATERAL (
      SELECT (floor(extract(epoch FROM ${now}::timestamptz) / (w.interval_minutes * 60)) * w.interval_minutes * 60)::bigint AS epoch
    ) slot
    ON CONFLICT DO NOTHING
    RETURNING id`;

  const rerouted = await db`
    UPDATE jobs j SET route = d.route
    FROM watch_variants v, watches w, domains d
    WHERE j.status = 'queued' AND NOT j.is_probe
      AND v.id = j.variant_id AND w.id = v.watch_id AND d.domain = j.domain
      AND w.route_override = 'auto' AND j.route <> d.route
    RETURNING j.id`;

  let probes = 0;
  const localDomains = await db<{ domain: string; route: CollectorKind; routeChangedAt: Date; lastProbeAt: Date | null }[]>`
    SELECT domain, route, route_changed_at, last_probe_at FROM domains WHERE route = 'local'`;
  for (const d of localDomains) {
    if (!isProbeDue({ route: d.route, changedAt: d.routeChangedAt, lastProbeAt: d.lastProbeAt }, now, routing)) continue;
    const inserted = await db`
      INSERT INTO jobs (variant_id, domain, url, route, is_probe, idempotency_key, scheduled_for)
      SELECT v.id, w.domain, COALESCE(v.url, w.url), 'cloud', true,
             v.id || ':probe:' || ${Math.floor(now.getTime() / 1000)}, ${now}
      FROM watch_variants v JOIN watches w ON w.id = v.watch_id
      WHERE w.domain = ${d.domain} AND w.active AND w.route_override = 'auto'
      ORDER BY random()
      LIMIT 1
      ON CONFLICT DO NOTHING
      RETURNING id`;
    await db`UPDATE domains SET last_probe_at = ${now} WHERE domain = ${d.domain}`;
    probes += inserted.length;
  }

  return { scheduled: scheduled.length, probes, rerouted: rerouted.length, failed: failed.length };
}
