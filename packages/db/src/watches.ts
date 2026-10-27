import type postgres from 'postgres';
import { domainOf, type CollectorKind, type ExtractionRule, type ObservationStatus, type RouteOverride } from '@undercut/core';
import { inTransaction, type Db } from './client';
import { toNumberOrNull, type Domain, type Watch, type WatchVariant } from './types';

export interface WatchInput {
  name: string;
  url: string;
  extraction: ExtractionRule;
  currency?: string | null | undefined;
  locale?: string | null | undefined;
  intervalMinutes: number;
  routeOverride: RouteOverride;
  active?: boolean | undefined;
}

export const DEFAULT_VARIANT_LABEL = 'Default';

/**
 * The rule as a plain JSON value (no `undefined` fields) for `sql.json`. Passing a pre-stringified
 * value instead would be serialized again and stored as a JSON string, not an object.
 */
function asJson(rule: ExtractionRule): postgres.JSONValue {
  return rule.attribute ? { kind: rule.kind, selector: rule.selector, attribute: rule.attribute } : { kind: rule.kind, selector: rule.selector };
}

async function ensureDomain(db: Db, domain: string): Promise<void> {
  await db`INSERT INTO domains (domain) VALUES (${domain}) ON CONFLICT (domain) DO NOTHING`;
}

/** Creates a watch and its default variant; registers the domain on first sight. */
export async function createWatch(db: Db, input: WatchInput): Promise<Watch> {
  const domain = domainOf(input.url);
  return inTransaction(db, async (tx) => {
    await ensureDomain(tx, domain);
    const [watch] = await tx<Watch[]>`
      INSERT INTO watches (name, url, domain, extraction, currency, locale, interval_minutes, route_override, active)
      VALUES (${input.name}, ${input.url}, ${domain}, ${tx.json(asJson(input.extraction))},
              ${input.currency ?? null}, ${input.locale ?? null}, ${input.intervalMinutes},
              ${input.routeOverride}, ${input.active ?? true})
      RETURNING *`;
    if (!watch) throw new Error('insert returned no row');
    await tx`INSERT INTO watch_variants (watch_id, label) VALUES (${watch.id}, ${DEFAULT_VARIANT_LABEL})`;
    return watch;
  });
}

export async function updateWatch(db: Db, id: string, input: WatchInput): Promise<Watch | null> {
  const domain = domainOf(input.url);
  return inTransaction(db, async (tx) => {
    await ensureDomain(tx, domain);
    const [watch] = await tx<Watch[]>`
      UPDATE watches SET
        name = ${input.name}, url = ${input.url}, domain = ${domain},
        extraction = ${tx.json(asJson(input.extraction))},
        currency = ${input.currency ?? null}, locale = ${input.locale ?? null},
        interval_minutes = ${input.intervalMinutes}, route_override = ${input.routeOverride},
        active = ${input.active ?? true}, updated_at = now()
      WHERE id = ${id}
      RETURNING *`;
    return watch ?? null;
  });
}

export async function deleteWatch(db: Db, id: string): Promise<boolean> {
  const rows = await db`DELETE FROM watches WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export interface WatchDetail {
  watch: Watch;
  variants: WatchVariant[];
  domain: Domain;
}

export async function getWatch(db: Db, id: string): Promise<WatchDetail | null> {
  const [watch] = await db<Watch[]>`SELECT * FROM watches WHERE id = ${id}`;
  if (!watch) return null;
  const variants = await db<WatchVariant[]>`SELECT * FROM watch_variants WHERE watch_id = ${id} ORDER BY created_at`;
  const [domain] = await db<Domain[]>`SELECT * FROM domains WHERE domain = ${watch.domain}`;
  if (!domain) throw new Error(`watch ${id} references unknown domain ${watch.domain}`);
  return { watch, variants, domain };
}

export interface WatchSummary {
  id: string;
  name: string;
  url: string;
  domain: string;
  active: boolean;
  intervalMinutes: number;
  routeOverride: RouteOverride;
  domainRoute: CollectorKind;
  latestPrice: number | null;
  latestCurrency: string | null;
  latestPriceAt: Date | null;
  lastStatus: ObservationStatus | null;
  lastAttemptAt: Date | null;
  /** Up to 30 recent ok prices, oldest first, for a sparkline. */
  recentPrices: number[];
  pendingJob: boolean;
}

export async function listWatchSummaries(db: Db): Promise<WatchSummary[]> {
  const rows = await db<(Omit<WatchSummary, 'latestPrice' | 'recentPrices'> & { latestPrice: string | null; recentPrices: string[] | null })[]>`
    SELECT
      w.id, w.name, w.url, w.domain, w.active, w.interval_minutes, w.route_override,
      d.route AS domain_route,
      latest_ok.price AS latest_price, latest_ok.currency AS latest_currency, latest_ok.as_of AS latest_price_at,
      last_any.status AS last_status, last_any.as_of AS last_attempt_at,
      spark.prices AS recent_prices,
      EXISTS (
        SELECT 1 FROM jobs j JOIN watch_variants v ON v.id = j.variant_id
        WHERE v.watch_id = w.id AND j.status IN ('queued', 'leased')
      ) AS pending_job
    FROM watches w
    JOIN domains d ON d.domain = w.domain
    LEFT JOIN LATERAL (
      SELECT o.price, o.currency, o.as_of FROM observations o JOIN watch_variants v ON v.id = o.variant_id
      WHERE v.watch_id = w.id AND o.status = 'ok' ORDER BY o.as_of DESC LIMIT 1
    ) latest_ok ON true
    LEFT JOIN LATERAL (
      SELECT o.status, o.as_of FROM observations o JOIN watch_variants v ON v.id = o.variant_id
      WHERE v.watch_id = w.id ORDER BY o.as_of DESC LIMIT 1
    ) last_any ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(price ORDER BY as_of) AS prices FROM (
        SELECT o.price, o.as_of FROM observations o JOIN watch_variants v ON v.id = o.variant_id
        WHERE v.watch_id = w.id AND o.status = 'ok' ORDER BY o.as_of DESC LIMIT 30
      ) recent
    ) spark ON true
    ORDER BY w.created_at DESC`;

  return rows.map((r) => ({
    ...r,
    latestPrice: toNumberOrNull(r.latestPrice),
    recentPrices: (r.recentPrices ?? []).map(Number),
  }));
}
