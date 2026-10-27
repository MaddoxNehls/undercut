import { createDb } from '../client';
import { schedulerTick } from '../scheduler';

/** Local-dev scheduler loop. In production the same tick runs from a cron (POST /api/cron/tick). */
const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 15_000);
const db = createDb(process.env.DATABASE_URL, { max: 2 });
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
  } catch (err) {
    console.error('scheduler tick failed:', err);
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
await db.end();
