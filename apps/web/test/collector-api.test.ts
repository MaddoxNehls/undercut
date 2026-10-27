import { randomUUID } from 'node:crypto';
import { createCollector, createDb, createWatch, enqueueNow, type Db } from '@undercut/db';
import { migrate } from '@undercut/db/migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Exercises the collector API route handlers directly (they are plain Request -> Response
 * functions) against a throwaway database: device auth, long-poll leasing, fencing, validation.
 */
const BASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://undercut:undercut@127.0.0.1:5447/undercut';
const name = `undercut_test_api_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
const admin = createDb(BASE_URL, { max: 1 });
let db: Db;
let routes: {
  lease: typeof import('../app/api/collector/lease/route');
  result: typeof import('../app/api/collector/jobs/[id]/result/route');
  heartbeat: typeof import('../app/api/collector/heartbeat/route');
};
let cloudToken: string;
let localToken: string;

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const url = new URL(BASE_URL);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  db = createDb(url.toString(), { max: 2 });
  await migrate(db);
  routes = {
    lease: await import('../app/api/collector/lease/route'),
    result: await import('../app/api/collector/jobs/[id]/result/route'),
    heartbeat: await import('../app/api/collector/heartbeat/route'),
  };
  cloudToken = (await createCollector(db, { kind: 'cloud', name: 'api-cloud' })).token;
  localToken = (await createCollector(db, { kind: 'local', name: 'api-laptop' })).token;
});

afterAll(async () => {
  const shared = (globalThis as { __undercutDb?: Db }).__undercutDb;
  await Promise.all([db?.end(), shared?.end()]);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

const post = (path: string, token: string | null, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const resultFor = (jobId: string, body: unknown, token: string) =>
  routes.result.POST(post(`/api/collector/jobs/${jobId}/result`, token, body), { params: Promise.resolve({ id: jobId }) });

async function queueJob(route: 'cloud' | 'local'): Promise<void> {
  const watch = await createWatch(db, {
    name: 'API test',
    url: `https://api-${randomUUID().slice(0, 8)}.test/item`,
    extraction: { kind: 'selector', selector: '.price' },
    intervalMinutes: 60,
    routeOverride: route,
  });
  await enqueueNow(db, watch.id);
}

describe('collector API', () => {
  it('rejects missing, unknown, and revoked tokens', async () => {
    expect((await routes.lease.POST(post('/api/collector/lease', null, {}))).status).toBe(401);
    expect((await routes.lease.POST(post('/api/collector/lease', 'uc_local_nope', {}))).status).toBe(401);

    const { collector, token } = await createCollector(db, { kind: 'local', name: 'stolen-laptop' });
    await db`UPDATE collectors SET revoked_at = now() WHERE id = ${collector.id}`;
    expect((await routes.heartbeat.POST(post('/api/collector/heartbeat', token, { version: 't' }))).status).toBe(401);
  });

  it('stores only a hash of the device token', async () => {
    const rows = await db<{ tokenHash: string }[]>`SELECT token_hash FROM collectors`;
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash))).toBe(true);
    expect(rows.some((r) => r.tokenHash.includes(localToken.slice(9, 20)))).toBe(false);
  });

  it('validates request bodies', async () => {
    const response = await routes.lease.POST(post('/api/collector/lease', localToken, { waitMs: 999_999 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_body' });
  });

  it('long-polls, routes by collector kind, and accepts the current lease holder result', async () => {
    const pending = routes.lease.POST(post('/api/collector/lease', localToken, { waitMs: 5000 }));
    setTimeout(() => void queueJob('local'), 300);
    const { job } = (await (await pending).json()) as { job: { jobId: string; leaseId: string } | null };
    expect(job).not.toBeNull();

    const cloudLease = await (await routes.lease.POST(post('/api/collector/lease', cloudToken, { waitMs: 0 }))).json();
    expect(cloudLease).toEqual({ job: null });

    const heartbeat = await routes.heartbeat.POST(post('/api/collector/heartbeat', localToken, { version: 't', activeLeaseIds: [job!.leaseId] }));
    expect(await heartbeat.json()).toMatchObject({ kind: 'local', name: 'api-laptop', extendedLeases: 1 });

    const result = {
      status: 'ok',
      leaseId: job!.leaseId,
      price: { amount: 433, currency: 'USD', kind: 'from', period: 'night' },
      snippet: '<span>from $433/night</span>',
      asOf: new Date().toISOString(),
      httpStatus: 200,
      finalUrl: 'https://example.test',
      durationMs: 900,
    };
    const accepted = await resultFor(job!.jobId, result, localToken);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ accepted: true, observationId: expect.any(String) });
  });

  it('answers 409 to a fenced-out lease and 404 to an unknown job', async () => {
    await queueJob('cloud');
    const { job } = (await (await routes.lease.POST(post('/api/collector/lease', cloudToken, {}))).json()) as { job: { jobId: string } };
    const stale = { status: 'error', leaseId: randomUUID(), error: 'timeout' };
    expect((await resultFor(job.jobId, stale, cloudToken)).status).toBe(409);
    expect((await resultFor(randomUUID(), stale, cloudToken)).status).toBe(404);
  });
});
