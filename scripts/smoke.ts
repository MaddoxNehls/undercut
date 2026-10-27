/**
 * Live end-to-end smoke run against books.toscrape.com, a site built for scraping practice:
 *
 *   watch -> job -> cloud worker (over the real collector HTTP API) -> observation -> chart
 *
 * Prerequisites: `pnpm db:up && pnpm db:migrate`, the web app running at UNDERCUT_SERVER_URL,
 * a cloud token in UNDERCUT_COLLECTOR_TOKEN, and `pnpm --filter @undercut/worker build`.
 * Re-runnable: existing watches are reused, and each run adds ROUNDS observations per book.
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createDb, createWatch, enqueueNow, listObservations, type Db } from '@undercut/db';
import { chromium } from 'playwright';

const SERVER = process.env.UNDERCUT_SERVER_URL ?? 'http://localhost:3210';
const ROUNDS = Number(process.env.SMOKE_ROUNDS ?? 3);
const BOOKS = [
  { name: 'A Light in the Attic', slug: 'a-light-in-the-attic_1000' },
  { name: 'Tipping the Velvet', slug: 'tipping-the-velvet_999' },
  { name: 'Soumission', slug: 'soumission_998' },
];

async function ensureWatch(db: Db, name: string, url: string): Promise<string> {
  const [existing] = await db<{ id: string }[]>`SELECT id FROM watches WHERE url = ${url}`;
  if (existing) return existing.id;
  const watch = await createWatch(db, {
    name,
    url,
    extraction: { kind: 'selector', selector: '.product_main .price_color' },
    currency: 'GBP',
    intervalMinutes: 360,
    routeOverride: 'auto',
  });
  return watch.id;
}

function runWorkerOnce(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'apps/worker/dist/main.js', '--once', '--concurrency', '2'], {
      stdio: 'inherit',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`))));
  });
}

const db = createDb();
try {
  const ids: string[] = [];
  for (const book of BOOKS) ids.push(await ensureWatch(db, book.name, `https://books.toscrape.com/catalogue/${book.slug}/index.html`));
  console.log(`watches: ${ids.length}`);

  for (let round = 1; round <= ROUNDS; round++) {
    let queued = 0;
    for (const id of ids) queued += await enqueueNow(db, id);
    console.log(`round ${round}/${ROUNDS}: queued ${queued} job(s); running the cloud worker`);
    await runWorkerOnce();
  }

  const [first] = ids;
  if (!first) throw new Error('no watch');
  const log = await listObservations(db, first, 10);
  console.table(log.map((o) => ({ asOf: o.asOf.toISOString(), status: o.status, price: o.price, currency: o.currency, collector: o.collectorName, http: o.httpStatus })));
  const latest = log.find((o) => o.status === 'ok');
  if (!latest) throw new Error('no successful observation recorded');
  console.log(`observed: ${BOOKS[0]?.name} = ${latest.currency} ${latest.price} as of ${latest.asOf.toISOString()}`);

  await mkdir('docs/screenshots', { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    await page.goto(`${SERVER}/watches/${first}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'docs/screenshots/watch-detail.png', fullPage: true });
    await page.goto(SERVER, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'docs/screenshots/watches.png', fullPage: true });
    await page.goto(`${SERVER}/devices`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'docs/screenshots/devices.png', fullPage: true });
  } finally {
    await browser.close();
  }
  console.log('screenshots: docs/screenshots/{watch-detail,watches,devices}.png');
} finally {
  await db.end();
}
