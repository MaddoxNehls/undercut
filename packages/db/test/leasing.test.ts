import { describe, expect, it } from 'vitest';
import {
  createDb,
  enqueueNow,
  leaseJob,
  LeaseLostError,
  schedulerTick,
  submitResult,
  waitForLease,
  type Db,
} from '../src/index';
import { blockedResult, countRows, makeCollector, makeWatch, okResult, useTestDb } from './helpers';

const testDb = useTestDb();

async function expireLease(db: Db, jobId: string): Promise<void> {
  await db`UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE id = ${jobId}`;
}

describe('job leasing', () => {
  it('two collectors racing over separate connection pools lease each job exactly once', async () => {
    const db = testDb.db();
    const JOBS = 60;
    for (let i = 0; i < JOBS; i++) await makeWatch(db, `https://race-${i}.test/item`);
    await schedulerTick(db);
    expect(await countRows(db, 'jobs')).toBe(JOBS);

    const a = await makeCollector(db, 'cloud', 'racer-a');
    const b = await makeCollector(db, 'cloud', 'racer-b');
    const poolA = createDb(testDb.url(), { max: 6 });
    const poolB = createDb(testDb.url(), { max: 6 });

    // Each collector runs 6 concurrent lease loops on its own pool: 12 contenders in total.
    // SKIP LOCKED may answer "nothing" while every remaining job is momentarily locked by a rival,
    // so, like a real collector, a loop only stops once no queued job is left.
    const queuedLeft = async (pool: Db) => (await pool<{ n: number }[]>`SELECT count(*)::int AS n FROM jobs WHERE status = 'queued'`)[0]?.n ?? 0;
    const drain = async (pool: Db, collector: typeof a): Promise<string[]> => {
      const got: string[] = [];
      for (;;) {
        const job = await leaseJob(pool, collector);
        if (job) got.push(job.jobId);
        else if ((await queuedLeft(pool)) === 0) return got;
      }
    };
    try {
      const results = await Promise.all([...Array.from({ length: 6 }, () => drain(poolA, a)), ...Array.from({ length: 6 }, () => drain(poolB, b))]);
      const leased = results.flat();
      expect(leased).toHaveLength(JOBS);
      expect(new Set(leased).size).toBe(JOBS);
      expect(results.slice(0, 6).flat().length).toBeGreaterThan(0);
      expect(results.slice(6).flat().length).toBeGreaterThan(0);
    } finally {
      await Promise.all([poolA.end(), poolB.end()]);
    }

    const [stats] = await db<{ leased: number; maxAttempts: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'leased')::int AS leased, max(attempts)::int AS max_attempts FROM jobs`;
    expect(stats).toEqual({ leased: JOBS, maxAttempts: 1 });
  });

  it('re-leases an expired lease to another collector and fences out the stale holder', async () => {
    const db = testDb.db();
    await makeWatch(db, 'https://expiry.test/item');
    await schedulerTick(db);
    const slow = await makeCollector(db, 'cloud');
    const rescuer = await makeCollector(db, 'cloud');

    const first = await leaseJob(db, slow);
    expect(first).not.toBeNull();
    expect(await leaseJob(db, rescuer)).toBeNull();

    await expireLease(db, first!.jobId);
    const second = await leaseJob(db, rescuer);
    expect(second?.jobId).toBe(first!.jobId);
    expect(second?.leaseId).not.toBe(first!.leaseId);

    await expect(submitResult(db, slow, first!.jobId, okResult(first!.leaseId))).rejects.toBeInstanceOf(LeaseLostError);
    const accepted = await submitResult(db, rescuer, second!.jobId, okResult(second!.leaseId));
    expect(accepted).toMatchObject({ accepted: true, duplicate: false });

    const [job] = await db<{ status: string; attempts: number }[]>`SELECT status, attempts FROM jobs WHERE id = ${first!.jobId}`;
    expect(job).toEqual({ status: 'done', attempts: 2 });
    const [obs] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM observations WHERE job_id = ${first!.jobId}`;
    expect(obs?.n).toBe(1);
  });

  it('treats a replayed result as a no-op instead of double-recording', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://replay.test/item');
    await enqueueNow(db, watch.id);
    const collector = await makeCollector(db, 'cloud');
    const job = await leaseJob(db, collector);
    const before = await countRows(db, 'observations');

    const result = okResult(job!.leaseId);
    const first = await submitResult(db, collector, job!.jobId, result);
    const replay = await submitResult(db, collector, job!.jobId, result);

    expect(replay).toEqual({ accepted: true, observationId: first.observationId, duplicate: true });
    expect(await countRows(db, 'observations')).toBe(before + 1);
  });

  it('requeues a failed attempt with backoff, and fails the job after max attempts', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://flaky.test/item');
    await enqueueNow(db, watch.id);
    const collector = await makeCollector(db, 'cloud');

    const job = await leaseJob(db, collector);
    await submitResult(db, collector, job!.jobId, { status: 'error', leaseId: job!.leaseId, error: 'navigation timeout' });
    const [requeued] = await db<{ status: string; leaseId: string | null; backoff: boolean }[]>`
      SELECT status, lease_id, not_before > now() AS backoff FROM jobs WHERE id = ${job!.jobId}`;
    expect(requeued).toEqual({ status: 'queued', leaseId: null, backoff: true });

    // Skip the backoff and burn the remaining attempts via expired leases.
    for (let attempt = 2; attempt <= 3; attempt++) {
      await db`UPDATE jobs SET not_before = now() WHERE id = ${job!.jobId}`;
      const again = await leaseJob(db, collector);
      expect(again?.jobId).toBe(job!.jobId);
      await expireLease(db, job!.jobId);
    }
    expect(await leaseJob(db, collector)).toBeNull();
    const tick = await schedulerTick(db);
    expect(tick.failed).toBeGreaterThanOrEqual(1);
    const [failed] = await db<{ status: string }[]>`SELECT status FROM jobs WHERE id = ${job!.jobId}`;
    expect(failed?.status).toBe('failed');
  });

  it('only hands jobs to the collector kind they are routed to', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://local-only.test/item', { routeOverride: 'local' });
    await enqueueNow(db, watch.id);
    const cloud = await makeCollector(db, 'cloud');
    const device = await makeCollector(db, 'local');

    expect(await leaseJob(db, cloud)).toBeNull();
    const job = await leaseJob(db, device);
    expect(job?.url).toBe('https://local-only.test/item');
  });

  it('long-polls until a job appears', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://longpoll.test/item', { routeOverride: 'local' });
    const device = await makeCollector(db, 'local');

    const started = Date.now();
    const pending = waitForLease(db, device, { waitMs: 5000, pollMs: 100 });
    setTimeout(() => void enqueueNow(db, watch.id), 400);
    const job = await pending;
    expect(job?.url).toBe('https://longpoll.test/item');
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    await submitResult(db, device, job!.jobId, blockedResult(job!.leaseId));
  });
});

describe('politeness', () => {
  it('enforces per-domain concurrency, even between racing collectors', async () => {
    const db = testDb.db();
    const w1 = await makeWatch(db, 'https://polite.test/a');
    const w2 = await makeWatch(db, 'https://polite.test/b');
    await db`UPDATE domains SET max_concurrency = 1 WHERE domain = 'polite.test'`;
    await enqueueNow(db, w1.id);
    await enqueueNow(db, w2.id);
    const a = await makeCollector(db, 'cloud');
    const b = await makeCollector(db, 'cloud');

    const attempts = await Promise.all([a, b, a, b].map(async (collector) => ({ collector, job: await leaseJob(db, collector) })));
    const winners = attempts.filter((x) => x.job?.domain === 'polite.test');
    expect(winners).toHaveLength(1);

    const { collector, job } = winners[0]!;
    await submitResult(db, collector, job!.jobId, okResult(job!.leaseId));
    const next = await leaseJob(db, b);
    expect(next?.domain).toBe('polite.test');
  });

  it('spaces requests to the same domain by min_interval_ms', async () => {
    const db = testDb.db();
    const w1 = await makeWatch(db, 'https://spaced.test/a');
    const w2 = await makeWatch(db, 'https://spaced.test/b');
    await db`UPDATE domains SET min_interval_ms = 60000 WHERE domain = 'spaced.test'`;
    await enqueueNow(db, w1.id);
    await enqueueNow(db, w2.id);
    const device = await makeCollector(db, 'cloud');

    const first = await leaseJob(db, device);
    expect(first?.domain).toBe('spaced.test');
    const second = await leaseJob(db, device);
    expect(second?.domain).not.toBe('spaced.test');

    await db`UPDATE domains SET last_dispatched_at = now() - interval '61 seconds' WHERE domain = 'spaced.test'`;
    expect((await leaseJob(db, device))?.domain).toBe('spaced.test');
  });
});
