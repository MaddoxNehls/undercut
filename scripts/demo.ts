/**
 * M3/M4 demos against the real database and a real browser. No live LLM calls are made: where
 * the LLM path runs, it is served by hand-authored replay fixtures (see packages/extraction/test/fixtures/replay).
 *
 *   tsx scripts/demo.ts fixture-site   serve the shop page on :5450 (v1; POST /__switch/v2 to redesign it)
 *   tsx scripts/demo.ts books          live extraction on books.toscrape.com (heuristics), plus a replayed LLM pass
 *   tsx scripts/demo.ts healing        v1 -> redesign -> 3 parse errors -> heal (replayed LLM) -> confirmed
 *   tsx scripts/demo.ts alerts         alert rules on a live books.toscrape watch, delivered to Mailpit + ntfy
 */
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { CollectorKind, ObservationHook } from '@undercut/core';
import { analyzeUrl, launchHeadlessBrowser, runCollector, type CollectorServer } from '@undercut/collector-runtime';
import {
  alertHook,
  createAlertRule,
  createCollector,
  createDb,
  createWatch,
  dispatchDeliveries,
  enqueueNow,
  healTick,
  listAlertRules,
  listAlerts,
  listSelectorHistory,
  recordHeartbeat,
  saveNotificationSettings,
  submitResult,
  waitForLease,
  type Db,
} from '@undercut/db';
import { LLM, ReplayBackend } from '@undercut/llm';
import { channelsFromEnv } from '@undercut/notify';

const FIXTURES = new URL('../packages/extraction/test/fixtures/', import.meta.url);
const SITE_PORT = 5450;
const PACK_URL = `http://127.0.0.1:${SITE_PORT}/pack`;
const BOOK_URL = 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html';
const replay = (name: string) => new LLM(new ReplayBackend(fileURLToPath(new URL(`replay/${name}`, FIXTURES))));

async function fixtureSite(): Promise<Server> {
  let version = 'shop-v1';
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/__switch/')) {
      version = req.url.endsWith('v2') ? 'shop-v2' : 'shop-v1';
      res.writeHead(204).end();
      return;
    }
    if (req.url !== '/pack') return void res.writeHead(404).end('not found');
    void readFile(new URL(`${version}.html`, FIXTURES), 'utf8').then((html) => res.writeHead(200, { 'content-type': 'text/html' }).end(html));
  });
  await new Promise<void>((resolve) => server.listen(SITE_PORT, '127.0.0.1', resolve));
  return server;
}

/** The collector protocol served in-process from the database layer (the HTTP API wraps the same calls). */
async function inProcessServer(db: Db, kind: CollectorKind, hooks: readonly ObservationHook[] = []): Promise<CollectorServer> {
  const name = `demo-${kind}`;
  const [existing] = await db<{ id: string }[]>`SELECT id FROM collectors WHERE name = ${name} AND revoked_at IS NULL`;
  const collector = { id: existing?.id ?? (await createCollector(db, { kind, name })).collector.id, kind, name };
  return {
    lease: (waitMs, signal) => waitForLease(db, collector, { waitMs: Math.min(waitMs, 8000), ...(signal ? { signal } : {}) }),
    submit: async (jobId, result) => ({ accepted: true, observationId: (await submitResult(db, collector, jobId, result, { hooks })).observationId }),
    heartbeat: async (body) => ({
      collectorId: collector.id,
      name,
      kind,
      extendedLeases: await recordHeartbeat(db, collector.id, { version: body.version, activeLeaseIds: body.activeLeaseIds ?? [] }, 120),
      serverTime: new Date().toISOString(),
    }),
  };
}

async function check(db: Db, server: CollectorServer, watchId: string): Promise<void> {
  await enqueueNow(db, watchId);
  const browser = await launchHeadlessBrowser();
  try {
    await runCollector({ server, context: browser.context, once: true, version: 'demo', log: (m, f) => console.log(`  ${m}`, f ? JSON.stringify(f) : '') });
  } finally {
    await browser.close();
  }
}

async function books(): Promise<void> {
  const browser = await launchHeadlessBrowser();
  try {
    const heuristic = await analyzeUrl(browser.context, BOOK_URL, { llm: null });
    const llm = replay('books-toscrape.json');
    const forced = await analyzeUrl(browser.context, BOOK_URL, { llm, forceLlm: true });
    const strip = (a: typeof heuristic) => ({ ...a, candidates: a.candidates.map(({ crop, ...c }) => ({ ...c, crop: crop ? `${crop.length} chars` : null })) });
    const record = { recordedAt: new Date().toISOString(), heuristicOnly: strip(heuristic), forcedLlmReplayed: { ...strip(forced), llmCalls: llm.usage } };
    await mkdir('docs/demo', { recursive: true });
    await writeFile('docs/demo/extraction-books-toscrape.json', `${JSON.stringify(record, null, 2)}\n`);
    console.log('heuristics:', heuristic.reason, heuristic.candidates.map((c) => `${c.source}/${c.meaning} ${JSON.stringify(c.rule)} = ${c.price?.amount}`));
    console.log('forced LLM (replayed):', forced.reason, forced.candidates.map((c) => `${c.source}/${c.meaning} ${JSON.stringify(c.rule)} = ${c.price?.amount}`));
    console.log('digest:', JSON.stringify(heuristic.digest));
  } finally {
    await browser.close();
  }
}

async function healing(db: Db): Promise<void> {
  const site = await fixtureSite();
  const toggle = (v: string) => fetch(`http://127.0.0.1:${SITE_PORT}/__switch/${v}`, { method: 'POST' });
  try {
    const watch = await createWatch(db, {
      name: 'Trailhead 40L Pack (self-healing demo)',
      url: PACK_URL,
      extraction: { kind: 'selector', selector: 'span.price-now' },
      currency: 'USD',
      intervalMinutes: 1440,
      routeOverride: 'cloud',
    });
    const server = await inProcessServer(db, 'cloud');
    console.log(`watch ${watch.id}\n1) v1 page`);
    await toggle('v1');
    await check(db, server, watch.id);
    console.log('2) the site ships a redesign (v2): three checks');
    await toggle('v2');
    for (let i = 0; i < 3; i++) await check(db, server, watch.id);
    console.log('3) heal tick (LLM served from a hand-authored replay fixture)');
    const llm = replay('shop-v2-heal.json');
    console.log(await healTick(db, { llm }), 'llm usage', llm.usage);
    console.log('4) confirming check with the healed selector');
    await check(db, server, watch.id);
    const history = await listSelectorHistory(db, watch.id);
    console.table(history.map((h) => ({ trigger: h.trigger, source: h.source, status: h.status, from: h.oldRule && JSON.stringify(h.oldRule), to: JSON.stringify(h.newRule), oldValue: h.oldValue, newValue: h.newValue })));
    const obs = await db<{ status: string; price: string | null; reason: string | null }[]>`
      SELECT o.status, o.price, o.reason FROM observations o JOIN watch_variants v ON v.id = o.variant_id WHERE v.watch_id = ${watch.id} ORDER BY o.as_of`;
    console.table(obs);
  } finally {
    site.close();
  }
}

async function alerts(db: Db): Promise<void> {
  const [watch] = await db<{ id: string }[]>`SELECT id FROM watches WHERE url = ${BOOK_URL}`;
  if (!watch) throw new Error('run `pnpm smoke` first to create the books.toscrape watches');
  const topic = 'undercut-demo';
  await saveNotificationSettings(db, { email: 'traveler@undercut.test', ntfyTopic: topic, quietStart: '23:00', quietEnd: '07:00', timeZone: 'America/Los_Angeles' });
  if ((await listAlertRules(db, watch.id)).length === 0) {
    await createAlertRule(db, watch.id, 'below_target', 55);
    await createAlertRule(db, watch.id, 'drop_pct', 10);
    await createAlertRule(db, watch.id, 'all_time_low', null);
  }
  const server = await inProcessServer(db, 'cloud', [alertHook(db)]);
  for (let i = 0; i < 2; i++) await check(db, server, watch.id);
  console.log('dispatch:', await dispatchDeliveries(db, channelsFromEnv(), { appUrl: 'http://localhost:3210' }));
  for (const a of await listAlerts(db, { watchId: watch.id })) console.log(`alert: ${a.message}`, a.deliveries.map((d) => `${d.channel}:${d.status}`).join(' '));
  const mail = (await (await fetch('http://127.0.0.1:5451/api/v1/messages?limit=1')).json()) as { messages: { Subject: string; Snippet: string }[] };
  console.log('mailpit latest:', mail.messages[0]?.Subject, '|', mail.messages[0]?.Snippet);
  const ntfy = (await (await fetch(`http://127.0.0.1:5453/${topic}/json?poll=1`)).text()).trim().split('\n').at(-1);
  console.log('ntfy latest:', ntfy);
}

const command = process.argv[2];
if (command === 'fixture-site') {
  await fixtureSite();
  console.log(`fixture site on ${PACK_URL} (POST /__switch/v2 to redesign)`);
} else if (command === 'books') {
  await books();
} else {
  const db = createDb();
  try {
    if (command === 'healing') await healing(db);
    else if (command === 'alerts') await alerts(db);
    else console.log('usage: tsx scripts/demo.ts fixture-site | books | healing | alerts');
  } finally {
    await db.end();
  }
}
