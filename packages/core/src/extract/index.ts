export { SelectorExtractor } from './selector-extractor';
export { JsonLdExtractor, findJsonLdOffers, type JsonLdOffer } from './json-ld-extractor';
export type { Extractor, ExtractionResult, PageSnapshot } from './types';

import type { ExtractionRule, ParseOptions } from '../types';
import { JsonLdExtractor } from './json-ld-extractor';
import { SelectorExtractor } from './selector-extractor';
import type { ExtractionResult, PageSnapshot } from './types';

const selector = new SelectorExtractor();
const jsonLd = new JsonLdExtractor();

/** Dispatches a rule to its extractor; the union keeps this switch exhaustive. */
export function extractPrice(page: PageSnapshot, rule: ExtractionRule, options: ParseOptions): Promise<ExtractionResult> {
  switch (rule.kind) {
    case 'selector':
      return selector.extract(page, rule, options);
    case 'json-ld':
      return jsonLd.extract(page, rule, options);
  }
}
