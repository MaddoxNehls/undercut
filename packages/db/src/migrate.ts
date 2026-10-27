import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Db } from './client';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Applies pending `migrations/*.sql` files in name order, each in its own transaction. */
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<string[]> {
  await db`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const applied = new Set((await db<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(`${MIGRATIONS_DIR}${file}`, 'utf8');
    await db.begin(async (tx) => {
      await tx.unsafe(body);
      await tx.unsafe('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    log(`applied ${file}`);
    ran.push(file);
  }
  return ran;
}
