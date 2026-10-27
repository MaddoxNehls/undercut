import type { CollectorKind } from '@undercut/core';
import type { Db } from './client';
import { generateToken, hashToken } from './tokens';
import type { Collector } from './types';

/** A collector seen within this window counts as online. */
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

const COLLECTOR_COLUMNS = 'id, kind, name, token_hint, version, hostname, last_seen_at, revoked_at, created_at';

/** Registers a collector and returns its token. The plaintext token is never stored or shown again. */
export async function createCollector(db: Db, input: { kind: CollectorKind; name: string }): Promise<{ collector: Collector; token: string }> {
  const { token, hash, hint } = generateToken(input.kind);
  const [collector] = await db<Collector[]>`
    INSERT INTO collectors (kind, name, token_hash, token_hint)
    VALUES (${input.kind}, ${input.name}, ${hash}, ${hint})
    RETURNING ${db.unsafe(COLLECTOR_COLUMNS)}`;
  if (!collector) throw new Error('insert returned no row');
  return { collector, token };
}

/** Resolves a bearer token to an active collector and marks it seen, in one round trip. */
export async function authenticateCollector(db: Db, token: string): Promise<Collector | null> {
  if (!token.startsWith('uc_')) return null;
  const [collector] = await db<Collector[]>`
    UPDATE collectors SET last_seen_at = now()
    WHERE token_hash = ${hashToken(token)} AND revoked_at IS NULL
    RETURNING ${db.unsafe(COLLECTOR_COLUMNS)}`;
  return collector ?? null;
}

export async function listCollectors(db: Db): Promise<Collector[]> {
  return db<Collector[]>`SELECT ${db.unsafe(COLLECTOR_COLUMNS)} FROM collectors ORDER BY revoked_at NULLS FIRST, created_at DESC`;
}

export async function revokeCollector(db: Db, id: string): Promise<boolean> {
  const rows = await db`UPDATE collectors SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/**
 * Records a heartbeat and extends the leases the collector says it is still working on, so a
 * slow page load is not mistaken for a dead collector.
 */
export async function recordHeartbeat(
  db: Db,
  collectorId: string,
  input: { version: string; hostname?: string | undefined; activeLeaseIds: readonly string[] },
  leaseSeconds: number,
): Promise<number> {
  await db`UPDATE collectors SET last_seen_at = now(), version = ${input.version}, hostname = ${input.hostname ?? null} WHERE id = ${collectorId}`;
  if (input.activeLeaseIds.length === 0) return 0;
  const extended = await db`
    UPDATE jobs SET lease_expires_at = now() + ${leaseSeconds}::int * interval '1 second'
    WHERE leased_by = ${collectorId} AND status = 'leased' AND lease_id = ANY(${input.activeLeaseIds as string[]}::uuid[])
    RETURNING id`;
  return extended.length;
}

export function isOnline(collector: Pick<Collector, 'lastSeenAt' | 'revokedAt'>, now = new Date()): boolean {
  return collector.revokedAt === null && collector.lastSeenAt !== null && now.getTime() - collector.lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}
