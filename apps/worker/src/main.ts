import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { CollectorApi, launchHeadlessBrowser, runCollector, type LogFn } from '@undercut/collector-runtime';

/**
 * Cloud collector. Leases jobs routed to `cloud` and captures them with headless Chromium.
 * Sites that block datacenter IPs show up as `blocked` observations, which is the signal the
 * scheduler uses to re-route that domain to local collectors.
 */
const VERSION = '0.1.0';

const { values } = parseArgs({
  options: {
    once: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: process.env.WORKER_CONCURRENCY ?? '2' },
  },
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set (see .env.example)`);
    process.exit(1);
  }
  return value;
}

// JSON lines: friendly to Fly.io / any log pipeline.
const log: LogFn = (msg, fields) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...fields }));

const server = new CollectorApi(requireEnv('UNDERCUT_SERVER_URL'), requireEnv('UNDERCUT_COLLECTOR_TOKEN'));
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => controller.abort());

const browser = await launchHeadlessBrowser();
log('worker started', { once: values.once, concurrency: Number(values.concurrency) });
try {
  const stats = await runCollector({
    server,
    context: browser.context,
    concurrency: Number(values.concurrency),
    once: values.once,
    version: `worker/${VERSION}`,
    hostname: hostname(),
    signal: controller.signal,
    log,
  });
  log('worker stopped', { ...stats });
} finally {
  await browser.close();
}
