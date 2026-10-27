import { COLLECTOR_KINDS, DEFAULT_ROUTING, type CollectorKind, type ObservationStatus } from '@undercut/core';
import type { Db } from './client';
import type { Domain } from './types';

export interface KindStats {
  attempts: number;
  ok: number;
  blocked: number;
  parseErrors: number;
  /** Block rate over the routing window: the number the policy actually acts on. */
  recentBlockRate: number | null;
  recentAttempts: number;
}

export interface DomainSummary extends Domain {
  watchCount: number;
  stats: Record<CollectorKind, KindStats>;
}

type TotalsRow = { domain: string; collectorKind: CollectorKind; attempts: number; ok: number; blocked: number; parseErrors: number };
type RecentRow = { domain: string; collectorKind: CollectorKind; status: ObservationStatus };

export async function listDomainSummaries(db: Db, window = DEFAULT_ROUTING.window): Promise<DomainSummary[]> {
  const domains = await db<(Domain & { watchCount: number })[]>`
    SELECT d.*, (SELECT count(*)::int FROM watches w WHERE w.domain = d.domain) AS watch_count
    FROM domains d ORDER BY d.domain`;
  const totals = await db<TotalsRow[]>`
    SELECT domain, collector_kind, attempts, ok, blocked, parse_errors FROM domain_stats`;
  const recent = await db<RecentRow[]>`
    SELECT domain, collector_kind, status FROM (
      SELECT domain, collector_kind, status,
             row_number() OVER (PARTITION BY domain, collector_kind ORDER BY recorded_at DESC) AS rn
      FROM observations
    ) ranked WHERE rn <= ${window}`;

  return domains.map((d) => {
    const statsFor = (kind: CollectorKind): KindStats => {
      const total = totals.find((t) => t.domain === d.domain && t.collectorKind === kind);
      const latest = recent.filter((r) => r.domain === d.domain && r.collectorKind === kind);
      return {
        attempts: total?.attempts ?? 0,
        ok: total?.ok ?? 0,
        blocked: total?.blocked ?? 0,
        parseErrors: total?.parseErrors ?? 0,
        recentAttempts: latest.length,
        recentBlockRate: latest.length ? latest.filter((r) => r.status === 'blocked').length / latest.length : null,
      };
    };
    const stats = Object.fromEntries(COLLECTOR_KINDS.map((k) => [k, statsFor(k)])) as Record<CollectorKind, KindStats>;
    return { ...d, stats };
  });
}
