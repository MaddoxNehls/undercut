import { createDb } from '../client';
import { migrate } from '../migrate';

const db = createDb(process.env.DATABASE_URL, { max: 1 });
try {
  const ran = await migrate(db, console.log);
  console.log(ran.length ? `migrated: ${ran.join(', ')}` : 'schema up to date');
} finally {
  await db.end();
}
