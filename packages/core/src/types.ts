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
 * How to find the price on a page: a CSS selector (optionally reading an attribute), or the
 * page's schema.org JSON-LD offer. LLM-derived rules are still selectors; provenance lives in
 * the selector history, not in the rule.
 */
export type ExtractionRule =
  | {
      kind: 'selector';
      selector: string;
      /** Read this attribute instead of text content, e.g. `content` on a <meta itemprop="price">. */
      attribute?: string | undefined;
    }
  | {
      kind: 'json-ld';
      /** Which offer field to read; `lowPrice` suits AggregateOffer ranges. */
      field: 'price' | 'lowPrice';
    };

/** What a price on the page means. Only `current` prices should feed alerts. */
export type PriceMeaning = 'current' | 'was' | 'per_unit' | 'total';
export const PRICE_MEANINGS: readonly PriceMeaning[] = ['current', 'was', 'per_unit', 'total'];

/** One-line form of a rule for display and the edit form: a CSS selector, or "json-ld". */
export function ruleToText(rule: ExtractionRule): string {
  if (rule.kind === 'json-ld') return rule.field === 'price' ? 'json-ld' : `json-ld:${rule.field}`;
  return rule.selector;
}

/** Inverse of `ruleToText`. */
export function ruleFromText(text: string, attribute?: string): ExtractionRule {
  const trimmed = text.trim();
  if (trimmed === 'json-ld') return { kind: 'json-ld', field: 'price' };
  if (trimmed === 'json-ld:lowPrice') return { kind: 'json-ld', field: 'lowPrice' };
  return attribute ? { kind: 'selector', selector: trimmed, attribute } : { kind: 'selector', selector: trimmed };
}
