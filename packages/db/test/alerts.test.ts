import { randomUUID } from 'node:crypto';
import type { ObservationRecorded } from '@undercut/core';
import { channelsFromEnv, type Channel } from '@undercut/notify';
import { describe, expect, it } from 'vitest';
import {
  alertHook,
  createAlertRule,
  createDb,
  dispatchDeliveries,
  enqueueNow,
  evaluateAlerts,
  leaseJob,
  listAlerts,
  saveNotificationSettings,
  submitResult,
  type Db,
} from '../src/index';
import { makeCollector, makeWatch, okResult, useTestDb } from './helpers';

const testDb = useTestDb();

/** Records ok observations through the real result path (no hooks), returning the last event. */
async function observe(db: Db, watchId: string, prices: number[]): Promise<ObservationRecorded> {
  const collector = await makeCollector(db, 'cloud');
  let event: ObservationRecorded | null = null;
  for (const price of prices) {
    await enqueueNow(db, watchId, new Date(Date.now() + Math.random() * 1e9));
    const job = await leaseJob(db, collector);
    await submitResult(db, collector, job!.jobId, okResult(job!.leaseId, price), {
      hooks: [{ name: 'capture', onObservation: async (e) => void (event = e) }],
    });
  }
  return event!;
}

async function settings(db: Db, overrides: Partial<Parameters<typeof saveNotificationSettings>[1]> = {}) {
  await saveNotificationSettings(db, { email: 'me@undercut.test', ntfyTopic: `undercut-test-${randomUUID().slice(0, 8)}`, quietStart: null, quietEnd: null, timeZone: 'UTC', ...overrides });
}

describe('alert recording', () => {
  it('fires once a below-target price is confirmed, and queues a delivery per channel', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://alerts.test/a');
    await createAlertRule(db, watch.id, 'below_target', 500);
    await settings(db);
    const hook = alertHook(db);

    const collector = await makeCollector(db, 'cloud');
    for (const price of [606, 499, 489, 489]) {
      await enqueueNow(db, watch.id, new Date(Date.now() + Math.random() * 1e9));
      const job = await leaseJob(db, collector);
      await submitResult(db, collector, job!.jobId, okResult(job!.leaseId, price), { hooks: [hook] });
    }
    const alerts = await listAlerts(db, { watchId: watch.id });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ price: 489, kind: 'below_target' });
    expect(alerts[0]?.deliveries.map((d) => d.channel)).toEqual(['email', 'ntfy']);
  });

  it('records exactly one alert when the same observation is evaluated concurrently from two pools', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://alerts.test/race');
    await createAlertRule(db, watch.id, 'below_target', 500);
    await settings(db);
    const event = await observe(db, watch.id, [489, 489]);

    const pools = [createDb(testDb.url(), { max: 4 }), createDb(testDb.url(), { max: 4 })];
    try {
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => evaluateAlerts(pools[i % 2]!, event)));
      expect(results.flat()).toHaveLength(1);
    } finally {
      await Promise.all(pools.map((p) => p.end()));
    }
    const [counts] = await db<{ alerts: number; deliveries: number }[]>`
      SELECT (SELECT count(*)::int FROM alerts) AS alerts, (SELECT count(*)::int FROM deliveries) AS deliveries`;
    expect(counts).toEqual({ alerts: 1, deliveries: 2 });
  });

  it('defers deliveries during quiet hours instead of dropping them', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://alerts.test/quiet');
    await createAlertRule(db, watch.id, 'below_target', 500);
    const now = new Date();
    const hhmm = (d: Date) => d.toISOString().slice(11, 16);
    await settings(db, { quietStart: hhmm(new Date(now.getTime() - 3_600_000)), quietEnd: hhmm(new Date(now.getTime() + 2 * 3_600_000)) });

    await evaluateAlerts(db, await observe(db, watch.id, [450, 450]));
    const [delivery] = (await listAlerts(db, { watchId: watch.id }))[0]!.deliveries;
    expect(delivery!.notBefore.getTime()).toBeGreaterThan(now.getTime() + 3_600_000);
  });
});

describe('delivery dispatch', () => {
  it('retries a failing channel with backoff and gives up after max attempts', async () => {
    const db = testDb.db();
    const watch = await makeWatch(db, 'https://alerts.test/retry');
    await createAlertRule(db, watch.id, 'below_target', 500);
    await settings(db, { ntfyTopic: null });
    await evaluateAlerts(db, await observe(db, watch.id, [450, 450]));

    const broken: Channel = { kind: 'email', send: () => Promise.reject(new Error('SMTP 421 try later')) };
    expect(await dispatchDeliveries(db, { email: broken })).toEqual({ sent: 0, retried: 1, failed: 0 });
    const [first] = await db<{ attempts: number; wait: number }[]>`SELECT attempts, extract(epoch FROM not_before - now())::int AS wait FROM deliveries`;
    expect(first).toMatchObject({ attempts: 1 });
    expect(first!.wait).toBeGreaterThanOrEqual(25);

    for (let i = 0; i < 4; i++) {
      await db`UPDATE deliveries SET not_before = now()`;
      await dispatchDeliveries(db, { email: broken });
    }
    const [last] = await db<{ status: string; attempts: number; lastError: string }[]>`SELECT status, attempts, last_error FROM deliveries`;
    expect(last).toEqual({ status: 'failed', attempts: 5, lastError: 'SMTP 421 try later' });
  });

  it('delivers to the real Mailpit and ntfy containers', async () => {
    const db = testDb.db();
    const name = `Alert e2e ${randomUUID().slice(0, 8)}`;
    const watch = await makeWatch(db, 'https://alerts.test/e2e');
    await db`UPDATE watches SET name = ${name} WHERE id = ${watch.id}`;
    const topic = `undercut-e2e-${randomUUID().slice(0, 8)}`;
    await createAlertRule(db, watch.id, 'below_target', 500);
    await settings(db, { email: 'traveler@undercut.test', ntfyTopic: topic });
    await evaluateAlerts(db, await observe(db, watch.id, [491, 489]));

    expect(await dispatchDeliveries(db, channelsFromEnv({}))).toEqual({ sent: 2, retried: 0, failed: 0 });

    const mail = (await (await fetch(`http://127.0.0.1:5451/api/v1/search?query=${encodeURIComponent(`subject:"${name}"`)}`)).json()) as {
      messages: { Subject: string; To: { Address: string }[] }[];
    };
    expect(mail.messages[0]).toMatchObject({ Subject: `Price alert: ${name}`, To: [{ Address: 'traveler@undercut.test' }] });

    const ntfy = (await (await fetch(`http://127.0.0.1:5453/${topic}/json?poll=1`)).text()).trim().split('\n').map((l) => JSON.parse(l) as { title: string; message: string });
    expect(ntfy[0]).toMatchObject({ title: `Price alert: ${name}`, message: expect.stringContaining('£489.00') });
  });
});
