import { createDb, type Db } from '@undercut/db';

const globalForDb = globalThis as typeof globalThis & { __undercutDb?: Db };

/** One pool per server process; cached on globalThis so dev hot reloads don't leak pools. Lazy so builds need no database. */
export function db(): Db {
  globalForDb.__undercutDb ??= createDb();
  return globalForDb.__undercutDb;
}
