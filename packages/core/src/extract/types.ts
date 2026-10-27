import type { ExtractionRule, ParseOptions, ParsedPrice } from '../types';

/** What a collector hands to an extractor: the rendered page, after JavaScript ran. */
export interface PageSnapshot {
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number | null;
  html: string;
}

export type ExtractionResult =
  | { status: 'ok'; price: ParsedPrice; text: string; snippet: string }
  /** The rule matched nothing; the page layout changed or the page isn't the real one. */
  | { status: 'not_found' }
  /** The element exists but is empty: typical of a price that bot defenses never filled in. */
  | { status: 'empty'; snippet: string }
  | { status: 'unparseable'; text: string; snippet: string };

/**
 * Turns a page into a price. M1 ships the selector extractor; M3's LLM-assisted extractor
 * implements the same contract (and is async for that reason), so collectors never change.
 */
export interface Extractor<R extends ExtractionRule = ExtractionRule> {
  readonly kind: R['kind'];
  extract(page: PageSnapshot, rule: R, options: ParseOptions): Promise<ExtractionResult>;
}
