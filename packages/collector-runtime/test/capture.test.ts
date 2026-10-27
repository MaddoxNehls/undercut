import { randomUUID } from 'node:crypto';
import type { JobResult, LeasedJob } from '@undercut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capture, launchHeadlessBrowser, RobotsCache, RobotsUnavailableError, type BrowserHandle } from '../src/index';
import { startFixtureServer, type FixtureServer } from './fixture-server';

let server: FixtureServer;
let browser: BrowserHandle;

beforeAll(async () => {
  [server, browser] = await Promise.all([startFixtureServer(), launchHeadlessBrowser()]);
});
afterAll(async () => {
  await Promise.all([browser?.close(), server?.close()]);
});

function job(path: string, selector = '.product_main .price_color'): LeasedJob {
  return {
    jobId: randomUUID(),
    leaseId: randomUUID(),
    leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    url: server.url(path),
    domain: '127.0.0.1',
    isProbe: false,
    extraction: { kind: 'selector', selector },
    parse: {},
    respectRobots: true,
  };
}

const run = (path: string, selector?: string): Promise<JobResult> => capture(browser.context, job(path, selector), { selectorTimeoutMs: 1500 });

describe('capture (real headless Chromium against local fixtures)', () => {
  it('extracts the price from a normal product page', async () => {
    const result = await run('/product');
    expect(result).toMatchObject({ status: 'ok', httpStatus: 200, price: { amount: 51.77, currency: 'GBP', kind: 'exact' } });
    expect(result.status === 'ok' && result.snippet).toContain('£51.77');
  });

  it('waits for a client-rendered price', async () => {
    const result = await run('/spa-product', '.nightly');
    expect(result).toMatchObject({ status: 'ok', price: { amount: 1299, currency: 'USD', kind: 'from', period: 'night' } });
  });

  it('records a WAF challenge served as 403 as blocked, not as an error', async () => {
    expect(await run('/challenge')).toMatchObject({ status: 'blocked', reason: 'http_403', httpStatus: 403 });
  });

  it('recognizes a challenge page even when it is served with 200', async () => {
    expect(await run('/soft-challenge')).toMatchObject({ status: 'blocked', reason: 'challenge:cloudflare', httpStatus: 200 });
  });

  it('records HTTP 429 as blocked', async () => {
    expect(await run('/rate-limited')).toMatchObject({ status: 'blocked', reason: 'http_429', httpStatus: 429 });
  });

  it('treats an app shell that never renders a price as blocked', async () => {
    expect(await run('/shell')).toMatchObject({ status: 'blocked', reason: 'empty_page' });
  });

  it('blames the selector, not the site, when a full page has no match', async () => {
    expect(await run('/redesigned')).toMatchObject({ status: 'parse_error', reason: 'selector_not_found' });
  });

  it('turns a plain 503 into a retryable error', async () => {
    expect(await run('/down')).toMatchObject({ status: 'error', error: 'http_503' });
  });

  it('turns a navigation failure into a retryable error', async () => {
    const result = await capture(browser.context, { ...job('/product'), url: 'http://127.0.0.1:1/unreachable' });
    expect(result.status).toBe('error');
  });
});

describe('RobotsCache', () => {
  it('honors Disallow rules and allows everything when robots.txt is missing', async () => {
    const robots = new RobotsCache();
    expect(await robots.isAllowed(server.url('/product'))).toBe(true);
    expect(await robots.isAllowed(server.url('/private/product'))).toBe(false);
  });

  it('refuses to guess when robots.txt is unreachable', async () => {
    await expect(new RobotsCache().isAllowed('http://127.0.0.1:1/item')).rejects.toBeInstanceOf(RobotsUnavailableError);
  });
});
