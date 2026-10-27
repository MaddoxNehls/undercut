/** Which kind of collector performs a job. Routing is a decision between these two. */
export type CollectorKind = 'cloud' | 'local';
export const COLLECTOR_KINDS: readonly CollectorKind[] = ['cloud', 'local'];

/** Per-watch routing: `auto` defers to the learned per-domain route. */
export type RouteOverride = 'auto' | CollectorKind;

/** Terminal outcome of a page capture, persisted on every observation. */
export type ObservationStatus = 'ok' | 'blocked' | 'parse_error';

export type JobStatus = 'queued' | 'leased' | 'done' | 'failed' | 'skipped';

export type PriceKind = 'exact' | 'from' | 'range';
export type PricePeriod = 'night' | 'day' | 'week' | 'month' | 'year' | 'person';

/** ISO 4217 code, e.g. "USD". Kept as a string: sites quote currencies we never enumerate. */
export type CurrencyCode = string;

export interface ParsedPrice {
  /** The trackable value: the exact price, or the low end of a range / "from" price. */
  amount: number;
  currency: CurrencyCode | null;
  kind: PriceKind;
  /** Upper bound, only for ranges. */
  max?: number;
  period?: PricePeriod;
}

export interface ParseOptions {
  /** BCP 47 locale of the page, used to disambiguate "1.299" vs "1,299". */
  locale?: string | undefined;
  /** Expected currency; resolves ambiguous symbols like "$" or "kr". */
  currency?: CurrencyCode | undefined;
}

/**
 * How to find the price on a page. M1 ships `selector`; M3 adds an LLM-derived rule
 * (still ultimately a selector, plus provenance), which is why this is a union.
 */
export type ExtractionRule = {
  kind: 'selector';
  selector: string;
  /** Read this attribute instead of text content, e.g. `content` on a <meta itemprop="price">. */
  attribute?: string | undefined;
};
