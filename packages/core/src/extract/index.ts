export { SelectorExtractor } from './selector-extractor';
export type { Extractor, ExtractionResult, PageSnapshot } from './types';

import type { ExtractionRule } from '../types';
import { SelectorExtractor } from './selector-extractor';
import type { ExtractionResult, PageSnapshot } from './types';
import type { ParseOptions } from '../types';

const selector = new SelectorExtractor();

/** Dispatches a rule to its extractor. M3 adds a case here; the union keeps it exhaustive. */
export function extractPrice(page: PageSnapshot, rule: ExtractionRule, options: ParseOptions): Promise<ExtractionResult> {
  switch (rule.kind) {
    case 'selector':
      return selector.extract(page, rule, options);
  }
}
