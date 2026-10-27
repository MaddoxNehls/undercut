import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { CollectorApi, CollectorApiError, launchLocalBrowser, runCollector } from '@undercut/collector-runtime';
import { clearConfig, configDir, loadConfig, profileDir, saveConfig } from './config';

const VERSION = '0.1.0';
const DEFAULT_SERVER = 'http://localhost:3210';

const HELP = `undercut-collector ${VERSION}: runs Undercut price checks in a real browser on this machine

Usage:
  undercut-collector login --token <device-token> [--server <url>]
  undercut-collector run [--headed] [--concurrency <n>] [--once] [--channel chrome|msedge] [--ignore-robots]
  undercut-collector status
  undercut-collector logout

Create a device token on the Devices page of your Undercut server.
Config and the browser profile live in ${configDir()} (override with UNDERCUT_HOME).`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    token: { type: 'string' },
    server: { type: 'string' },
    headed: { type: 'boolean', default: false },
    once: { type: 'boolean', default: false },
    concurrency: { type: 'string', default: '1' },
    channel: { type: 'string' },
    'ignore-robots': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

async function login(): Promise<void> {
  const token = values.token;
  if (!token) throw new Error('--token is required');
  const serverUrl = values.server ?? DEFAULT_SERVER;
  const me = await new CollectorApi(serverUrl, token).heartbeat({ version: `collector/${VERSION}`, hostname: hostname() });
  if (me.kind !== 'local') throw new Error(`that token belongs to a ${me.kind} collector; create a local device token instead`);
  await saveConfig({ serverUrl, token, collectorName: me.name });
  console.log(`Logged in to ${serverUrl} as "${me.name}". Start collecting with: undercut-collector run`);
}

async function run(): Promise<void> {
  const config = await requireConfig();
  const channel = values.channel;
  if (channel !== undefined && channel !== 'chrome' && channel !== 'msedge') throw new Error('--channel must be chrome or msedge');

  const browser = await launchLocalBrowser({ profileDir: profileDir(), headed: values.headed, channel });
  const controller = new AbortController();
  process.on('SIGINT', () => {
    console.log('\nfinishing in-flight jobs, then exiting...');
    controller.abort();
  });

  console.log(`"${config.collectorName}" collecting for ${config.serverUrl} with ${browser.channel}${values.headed ? ' (headed)' : ''}. Ctrl+C to stop.`);
  try {
    const stats = await runCollector({
      server: new CollectorApi(config.serverUrl, config.token),
      context: browser.context,
      concurrency: Number(values.concurrency),
      once: values.once,
      respectRobots: !values['ignore-robots'],
      version: `collector/${VERSION}`,
      hostname: hostname(),
      signal: controller.signal,
      log: (msg, fields) => console.log(`${new Date().toLocaleTimeString()}  ${msg}${fields ? `  ${JSON.stringify(fields)}` : ''}`),
    });
    console.log('stopped:', stats);
  } finally {
    await browser.close();
  }
}

async function status(): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.log('Not logged in. Run: undercut-collector login --token <device-token>');
    return;
  }
  const me = await new CollectorApi(config.serverUrl, config.token).heartbeat({ version: `collector/${VERSION}`, hostname: hostname() });
  console.log(`Logged in to ${config.serverUrl} as "${me.name}" (token …${config.token.slice(-4)}). Server time ${me.serverTime}.`);
}

async function requireConfig() {
  const config = await loadConfig();
  if (!config) throw new Error('not logged in; run `undercut-collector login --token <device-token>` first');
  return config;
}

const commands: Record<string, () => Promise<void>> = {
  login,
  run,
  status,
  logout: async () => {
    await clearConfig();
    console.log('Logged out. (The device token stays valid until revoked on the Devices page.)');
  },
};

const command = positionals[0];
const handler = command ? commands[command] : undefined;
if (!handler || values.help) {
  console.log(HELP);
  process.exitCode = handler || values.help ? 0 : 1;
} else {
  try {
    await handler();
  } catch (err) {
    const message = err instanceof CollectorApiError && err.status === 401 ? 'the server rejected this device token (unknown or revoked)' : err instanceof Error ? err.message : String(err);
    console.error(`error: ${message}`);
    process.exitCode = 1;
  }
}
