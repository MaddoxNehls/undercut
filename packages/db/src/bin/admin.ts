import { parseArgs } from 'node:util';
import { createDb } from '../client';
import { createCollector, listCollectors } from '../collectors';
import { schedulerTick } from '../scheduler';

const USAGE = `usage:
  admin create-collector --kind cloud|local --name <name>   prints a new device token (shown once)
  admin list-collectors
  admin tick                                                 runs one scheduler pass`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { kind: { type: 'string' }, name: { type: 'string' } },
});

const db = createDb(process.env.DATABASE_URL, { max: 1 });
try {
  switch (positionals[0]) {
    case 'create-collector': {
      const kind = values.kind;
      if (kind !== 'cloud' && kind !== 'local') throw new Error('--kind must be cloud or local');
      const { collector, token } = await createCollector(db, { kind, name: values.name ?? `${kind}-collector` });
      console.log(`created ${collector.kind} collector "${collector.name}" (${collector.id})`);
      console.log(token);
      break;
    }
    case 'list-collectors': {
      const rows = await listCollectors(db);
      console.table(rows.map(({ id, kind, name, lastSeenAt, revokedAt }) => ({ id, kind, name, lastSeenAt, revokedAt })));
      break;
    }
    case 'tick':
      console.log(await schedulerTick(db));
      break;
    default:
      console.log(USAGE);
      process.exitCode = 1;
  }
} finally {
  await db.end();
}
