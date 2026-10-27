import type { Db } from './client';
import { toNumberOrNull, type Observation } from './types';

export type ObservationLogEntry = Observation & { collectorName: string | null; variantLabel: string };

type RawObservation = Omit<ObservationLogEntry, 'price' | 'priceMax'> & { price: string | null; priceMax: string | null };

export async function listObservations(db: Db, watchId: string, limit = 100): Promise<ObservationLogEntry[]> {
  const rows = await db<RawObservation[]>`
    SELECT o.*, c.name AS collector_name, v.label AS variant_label
    FROM observations o
    JOIN watch_variants v ON v.id = o.variant_id
    LEFT JOIN collectors c ON c.id = o.collector_id
    WHERE v.watch_id = ${watchId}
    ORDER BY o.as_of DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, price: toNumberOrNull(r.price), priceMax: toNumberOrNull(r.priceMax) }));
}

export interface PricePoint {
  variantId: string;
  asOf: Date;
  price: number;
  currency: string | null;
  collectorKind: Observation['collectorKind'];
}

/** Successful observations for the watch, oldest first: the series behind the price chart. */
export async function priceHistory(db: Db, watchId: string, since: Date = new Date(0)): Promise<PricePoint[]> {
  const rows = await db<(Omit<PricePoint, 'price'> & { price: string })[]>`
    SELECT o.variant_id, o.as_of, o.price, o.currency, o.collector_kind
    FROM observations o JOIN watch_variants v ON v.id = o.variant_id
    WHERE v.watch_id = ${watchId} AND o.status = 'ok' AND o.as_of >= ${since}
    ORDER BY o.as_of`;
  return rows.map((r) => ({ ...r, price: Number(r.price) }));
}
