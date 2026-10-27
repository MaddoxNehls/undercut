import { randomUUID } from 'node:crypto';
import type { JobResult } from '@undercut/core';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createCollector, createDb, createWatch, type Db } from '../src/index';
import { migrate } from '../src/migrate';

const BASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://undercut:undercut@127.0.0.1:5447/undercut';

/**
 * Gives a test file its own freshly migrated database on the compose Postgres, dropped afterwards.
 * Files run in parallel, so sharing one database would let one file's collectors lease another's jobs.
 */
export function useTestDb(): { db: () => Db; url: () => string } {
  const name = `undercut_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const admin = createDb(BASE_URL, { max: 1 });
  const url = new URL(BASE_URL);
  url.pathname = `/${name}`;
  let db: Db | undefined;

  beforeAll(async () => {
    try {
      await admin.unsafe(`CREATE DATABASE ${name}`);
    } catch (err) {
      throw new Error(`Cannot reach Postgres at ${BASE_URL}. Run \`pnpm db:up\` first.\n${String(err)}`);
    }
    db = createDb(url.toString(), { max: 10 });
    await migrate(db);
  });

  // Tests in a file share the database; start each from empty so leftover jobs can't be leased.
  beforeEach(async () => {
    await db?.unsafe('TRUNCATE domains, watches, collectors, jobs, observations, domain_stats CASCADE');
  });

  afterAll(async () => {
    await db?.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });

  return {
    db: () => {
      if (!db) throw new Error('test database not ready');
      return db;
    },
    url: () => url.toString(),
  };
}

export async function makeWatch(db: Db, url: string, options: { routeOverride?: 'auto' | 'cloud' | 'local'; intervalMinutes?: number } = {}) {
  const watch = await createWatch(db, {
    name: `Watch ${url}`,
    url,
    extraction: { kind: 'selector', selector: '.price' },
    intervalMinutes: options.intervalMinutes ?? 60,
    routeOverride: options.routeOverride ?? 'auto',
  });
  // Tests exercise politeness explicitly; elsewhere it would only add waiting.
  await db`UPDATE domains SET min_interval_ms = 0, max_concurrency = 100 WHERE domain = ${watch.domain}`;
  return watch;
}

export async function makeCollector(db: Db, kind: 'cloud' | 'local', name = `${kind}-${randomUUID().slice(0, 6)}`) {
  return (await createCollector(db, { kind, name })).collector;
}

const meta = (leaseId: string) => ({
  leaseId,
  asOf: new Date().toISOString(),
  httpStatus: 200,
  finalUrl: 'https://example.test/item',
  durationMs: 1200,
});

export const okResult = (leaseId: string, amount = 51.77): JobResult => ({
  status: 'ok',
  price: { amount, currency: 'GBP', kind: 'exact' },
  snippet: `<p class="price">£${amount}</p>`,
  ...meta(leaseId),
});

export const blockedResult = (leaseId: string): JobResult => ({
  status: 'blocked',
  reason: 'http_403',
  snippet: 'Access denied',
  ...meta(leaseId),
  httpStatus: 403,
});

export async function countRows(db: Db, table: 'jobs' | 'observations'): Promise<number> {
  const [row] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM ${db(table)}`;
  return row?.n ?? 0;
}
