import { createDb } from '../client';
import { llmFromEnv } from '@undercut/llm';
import { channelsFromEnv } from '@undercut/notify';
import { dispatchDeliveries } from '../alerts';
import { healTick } from '../healing';
import { schedulerTick } from '../scheduler';

/** Local-dev scheduler loop. In production the same tick runs from a cron (POST /api/cron/tick). */
const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 15_000);
const db = createDb(process.env.DATABASE_URL, { max: 2 });
const llm = llmFromEnv();
const channels = channelsFromEnv();
let stopping = false;

const stop = (): void => {
  stopping = true;
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.log(`scheduler: ticking every ${intervalMs / 1000}s`);
while (!stopping) {
  try {
    const result = await schedulerTick(db);
    if (result.scheduled || result.probes || result.rerouted || result.failed) console.log('scheduler:', result);
    for (const healed of await healTick(db, { llm })) console.log('heal:', healed);
    const sent = await dispatchDeliveries(db, channels, { appUrl: process.env.UNDERCUT_SERVER_URL });
    if (sent.sent || sent.retried || sent.failed) console.log('deliveries:', sent);
  } catch (err) {
    console.error('scheduler tick failed:', err);
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
await db.end();
