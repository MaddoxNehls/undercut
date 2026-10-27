import { load } from 'cheerio';
import { parsePrice } from '../price/parse';
import type { ExtractionRule, ParseOptions } from '../types';
import type { ExtractionResult, Extractor, PageSnapshot } from './types';

const SNIPPET_MAX = 400;

type SelectorRule = Extract<ExtractionRule, { kind: 'selector' }>;

export class SelectorExtractor implements Extractor<SelectorRule> {
  readonly kind = 'selector';

  async extract(page: PageSnapshot, rule: SelectorRule, options: ParseOptions): Promise<ExtractionResult> {
    const $ = load(page.html);
    const el = $(rule.selector).first();
    if (el.length === 0) return { status: 'not_found' };

    const snippet = truncate($.html(el) ?? '', SNIPPET_MAX);
    const text = (rule.attribute ? el.attr(rule.attribute) ?? '' : el.text()).replace(/\s+/g, ' ').trim();
    if (text === '') return { status: 'empty', snippet };

    const price = parsePrice(text, options);
    return price ? { status: 'ok', price, text, snippet } : { status: 'unparseable', text, snippet };
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
