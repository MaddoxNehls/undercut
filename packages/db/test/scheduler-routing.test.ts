import { DEFAULT_ROUTING, type ObservationHook, type ObservationRecorded } from '@undercut/core';
import { describe, expect, it, vi } from 'vitest';
import { enqueueNow, leaseJob, schedulerTick, submitResult, type Db } from '../src/index';
import { blockedResult, makeCollector, makeWatch, okResult, useTestDb } from './helpers';

const testDb = useTestDb();
const HOUR = 60 * 60 * 1000;

async function jobsFor(db: Db, watchId: string) {
  return db<{ id: string; route: string; status: string; isProbe: boolean; idempotencyKey: string }[]>`
    SELECT j.id, j.route, j.status, j.is_probe, j.idempotency_key FROM jobs j
    JOIN watch_variants v ON v.id = j.variant_id WHERE v.watch_id = ${watchId} ORDER BY j.created_at`;
}

async function domainRoute(db: Db, domain: string) {
  const [row] = await db<{ route: string; routeReason: string | null }[]>`SELECT route, route_reason FROM domains WHERE domain = ${domain}`;
  return row;
}

describe('watches', () => {
  it('stores the extraction rule as a JSON object and hands it to collectors intact', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://json.test/item');
    const [row] = await db<{ type: string }[]>`SELECT jsonb_typeof(extraction) AS type FROM watches WHERE id = ${watch.id}`;
    expect(row?.type).toBe('object');

    await enqueueNow(db, watch.id);
    const job = await leaseJob(db, await makeCollector(db, 'cloud'));
    expect(job?.extraction).toEqual({ kind: 'selector', selector: '.price' });
  });
});

describe('scheduler', () => {
  it('creates exactly one job per slot, even when ticks race', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://slots.test/item', { intervalMinutes: 60 });
    const now = new Date('2026-11-01T10:20:00Z');

    await Promise.all(Array.from({ length: 8 }, () => schedulerTick(db, now)));
    await schedulerTick(db, new Date('2026-11-01T10:59:00Z'));
    const jobs = await jobsFor(db, watch.id);
    expect(jobs).toHaveLength(1);
    // Keyed to the start of the 10:00 hourly slot, whatever minute the tick ran at.
    const slotEpoch = Date.parse('2026-11-01T10:00:00Z') / 1000;
    expect(jobs[0]?.idempotencyKey.endsWith(`:${slotEpoch}`)).toBe(true);
  });

  it('skips a new slot while the previous job is still outstanding, then resumes', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://backlog.test/item', { intervalMinutes: 60, routeOverride: 'local' });
    await schedulerTick(db, new Date('2026-11-01T10:00:00Z'));
    await schedulerTick(db, new Date('2026-11-01T11:00:00Z'));
    await schedulerTick(db, new Date('2026-11-01T12:00:00Z'));
    expect(await jobsFor(db, watch.id)).toHaveLength(1);

    const device = await makeCollector(db, 'local');
    const job = await leaseJob(db, device);
    await submitResult(db, device, job!.jobId, okResult(job!.leaseId));
    await schedulerTick(db, new Date('2026-11-01T13:00:00Z'));
    const jobs = await jobsFor(db, watch.id);
    expect(jobs.map((j) => j.status)).toEqual(['done', 'queued']);
  });

  it('honors a per-watch route override', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://override.test/item', { routeOverride: 'local' });
    await schedulerTick(db);
    expect((await jobsFor(db, watch.id))[0]?.route).toBe('local');
  });
});

describe('learned routing, end to end', () => {
  it('moves a blocking domain to local, probes the cloud, and comes back after clean probes', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://blocky.test/hotel');
    const cloud = await makeCollector(db, 'cloud');
    const device = await makeCollector(db, 'local');

    // Four cloud attempts, three blocked: 75% > 50% threshold with the 4-sample minimum met.
    const outcomes = ['ok', 'blocked', 'blocked', 'blocked'] as const;
    for (const [i, outcome] of outcomes.entries()) {
      expect((await domainRoute(db, 'blocky.test'))?.route).toBe('cloud');
      await enqueueNow(db, watch.id, new Date(Date.now() + i * 1000));
      const job = await leaseJob(db, cloud);
      await submitResult(db, cloud, job!.jobId, outcome === 'ok' ? okResult(job!.leaseId) : blockedResult(job!.leaseId));
    }
    const switched = await domainRoute(db, 'blocky.test');
    expect(switched?.route).toBe('local');
    expect(switched?.routeReason).toContain('75%');

    // New work now goes to the device.
    await enqueueNow(db, watch.id, new Date(Date.now() + 10_000));
    expect(await leaseJob(db, cloud)).toBeNull();
    const localJob = await leaseJob(db, device);
    await submitResult(db, device, localJob!.jobId, okResult(localJob!.leaseId, 49.99));

    // Not due for a probe yet; after the probe interval, the tick adds a shadow cloud probe.
    const now = Date.now();
    expect((await schedulerTick(db, new Date(now + HOUR))).probes).toBe(0);
    for (const offset of [DEFAULT_ROUTING.probeEveryMs + HOUR, 2 * DEFAULT_ROUTING.probeEveryMs + 2 * HOUR]) {
      const tick = await schedulerTick(db, new Date(now + offset));
      expect(tick.probes).toBe(1);
      const probe = await leaseJob(db, cloud);
      expect(probe?.isProbe).toBe(true);
      await submitResult(db, cloud, probe!.jobId, okResult(probe!.leaseId));
    }

    const back = await domainRoute(db, 'blocky.test');
    expect(back?.route).toBe('cloud');
    expect(back?.routeReason).toContain('consecutive cloud probes');
  });

  it('reroutes jobs that were queued before the domain switched', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://switch.test/item');
    await enqueueNow(db, watch.id);
    await db`UPDATE domains SET route = 'local', route_changed_at = now() WHERE domain = 'switch.test'`;
    expect((await schedulerTick(db)).rerouted).toBeGreaterThanOrEqual(1);
    expect((await jobsFor(db, watch.id))[0]?.route).toBe('local');
  });
});

describe('observation hooks (alert engine slot)', () => {
  it('runs hooks after commit and never lets a failing hook lose data', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://hooks.test/item');
    await enqueueNow(db, watch.id);
    const cloud = await makeCollector(db, 'cloud');
    const job = await leaseJob(db, cloud);

    const seen: ObservationRecorded[] = [];
    const good: ObservationHook = { name: 'recorder', onObservation: async (e) => void seen.push(e) };
    const bad: ObservationHook = { name: 'exploder', onObservation: () => Promise.reject(new Error('smtp down')) };
    const onHookError = vi.fn();

    const outcome = await submitResult(db, cloud, job!.jobId, okResult(job!.leaseId, 42), { hooks: [bad, good], onHookError });
    expect(outcome.observationId).toBeTruthy();
    expect(seen).toEqual([expect.objectContaining({ watchId: watch.id, price: 42, status: 'ok', collectorKind: 'cloud' })]);
    expect(onHookError).toHaveBeenCalledWith('exploder', expect.any(Error));
  });
});
