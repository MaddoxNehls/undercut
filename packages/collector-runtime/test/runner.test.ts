import { randomUUID } from 'node:crypto';
import type { HeartbeatRequest, HeartbeatResponse, JobResult, JobResultResponse, LeasedJob } from '@undercut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CollectorApiError, launchHeadlessBrowser, runCollector, type BrowserHandle, type CollectorServer } from '../src/index';
import { startFixtureServer, type FixtureServer } from './fixture-server';

/** In-memory stand-in for the collector API: hands out queued jobs and records results. */
class FakeServer implements CollectorServer {
  readonly results = new Map<string, JobResult>();
  readonly heartbeats: HeartbeatRequest[] = [];
  constructor(
    private readonly queue: LeasedJob[],
    private readonly lostLeases = new Set<string>(),
  ) {}

  async lease(): Promise<LeasedJob | null> {
    return this.queue.shift() ?? null;
  }

  async submit(jobId: string, result: JobResult): Promise<JobResultResponse> {
    if (this.lostLeases.has(jobId)) throw new CollectorApiError(409, 'lease_lost', 'lease superseded');
    this.results.set(jobId, result);
    return { accepted: true, observationId: randomUUID() };
  }

  async heartbeat(body: HeartbeatRequest): Promise<HeartbeatResponse> {
    this.heartbeats.push(body);
    return { collectorId: randomUUID(), name: 'fake', kind: 'cloud', extendedLeases: 0, serverTime: new Date().toISOString() };
  }
}

let fixtures: FixtureServer;
let browser: BrowserHandle;

beforeAll(async () => {
  [fixtures, browser] = await Promise.all([startFixtureServer(), launchHeadlessBrowser()]);
});
afterAll(async () => {
  await Promise.all([browser?.close(), fixtures?.close()]);
});

function job(path: string, respectRobots = true): LeasedJob {
  return {
    jobId: randomUUID(),
    leaseId: randomUUID(),
    leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    url: fixtures.url(path),
    domain: '127.0.0.1',
    isProbe: false,
    extraction: { kind: 'selector', selector: '.product_main .price_color' },
    parse: {},
    respectRobots,
  };
}

describe('runCollector', () => {
  it('drains the queue in once-mode and reports one result per job', async () => {
    const jobs = [job('/product'), job('/challenge'), job('/rate-limited'), job('/private/product'), job('/private/product', false)];
    const server = new FakeServer([...jobs]);

    const stats = await runCollector({ server, context: browser.context, once: true, concurrency: 2, version: 'test', capture: { selectorTimeoutMs: 1000 } });

    expect(stats).toMatchObject({ processed: 5, ok: 2, blocked: 2, skipped: 1, errors: 0 });
    expect(server.results.get(jobs[0]!.jobId)).toMatchObject({ status: 'ok', price: { amount: 51.77 } });
    expect(server.results.get(jobs[3]!.jobId)).toMatchObject({ status: 'skipped', reason: expect.stringContaining('robots.txt') });
    // A domain that opted out of robots.txt checks is fetched normally.
    expect(server.results.get(jobs[4]!.jobId)).toMatchObject({ status: 'ok' });
    expect(server.heartbeats.length).toBeGreaterThanOrEqual(1);
  });

  it('discards a result whose lease was superseded and keeps going', async () => {
    const lost = job('/product');
    const kept = job('/product');
    const server = new FakeServer([lost, kept], new Set([lost.jobId]));

    const stats = await runCollector({ server, context: browser.context, once: true, version: 'test' });
    expect(stats.leaseLost).toBe(1);
    expect(server.results.has(kept.jobId)).toBe(true);
  });

  it('retries instead of skipping when robots.txt is unreachable', async () => {
    const unreachable = { ...job('/product'), url: 'http://127.0.0.1:1/item' };
    const server = new FakeServer([unreachable]);
    await runCollector({ server, context: browser.context, once: true, version: 'test' });
    expect(server.results.get(unreachable.jobId)).toMatchObject({ status: 'error', error: expect.stringContaining('robots.txt unreachable') });
  });

  it('can globally disable robots.txt checks', async () => {
    const server = new FakeServer([job('/private/product')]);
    const stats = await runCollector({ server, context: browser.context, once: true, respectRobots: false, version: 'test' });
    expect(stats.ok).toBe(1);
  });
});
