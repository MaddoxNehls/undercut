import postgres from 'postgres';

export type Db = postgres.Sql;

/** Rows come back camelCased (`lease_expires_at` -> `leaseExpiresAt`); timestamps are Dates. */
export function createDb(url: string | undefined = process.env.DATABASE_URL, options: { max?: number } = {}): Db {
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
  return postgres(url, {
    max: options.max ?? 10,
    transform: postgres.camel,
    onnotice: () => {},
  });
}

/**
 * Runs `fn` in a transaction. postgres.js types the transaction handle as a narrower interface
 * that drops the template-call signature; at runtime it is a full Sql, so we hand that out.
 */
export async function inTransaction<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return (await db.begin((tx) => fn(tx as unknown as Db))) as T;
}
