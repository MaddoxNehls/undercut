import { load } from 'cheerio';
import { parsePrice } from '../price/parse';
import type { ExtractionRule, ParseOptions } from '../types';
import type { ExtractionResult, Extractor, PageSnapshot } from './types';

type JsonLdRule = Extract<ExtractionRule, { kind: 'json-ld' }>;

export interface JsonLdOffer {
  price: string | number | undefined;
  lowPrice: string | number | undefined;
  priceCurrency: string | undefined;
}

/**
 * Reads the price from schema.org structured data, which sites publish for search engines and
 * which therefore survives visual redesigns far better than any CSS selector.
 */
export class JsonLdExtractor implements Extractor<JsonLdRule> {
  readonly kind = 'json-ld';

  async extract(page: PageSnapshot, rule: JsonLdRule, options: ParseOptions): Promise<ExtractionResult> {
    const offer = findJsonLdOffers(page.html).find((o) => o[rule.field] !== undefined);
    if (!offer) return { status: 'not_found' };
    const raw = String(offer[rule.field]);
    const snippet = JSON.stringify(offer).slice(0, 400);
    const price = parsePrice(raw, { ...options, currency: offer.priceCurrency ?? options.currency });
    if (!price) return { status: 'unparseable', text: raw, snippet };
    return {
      status: 'ok',
      price: { ...price, kind: rule.field === 'lowPrice' ? 'from' : price.kind },
      text: raw,
      snippet,
    };
  }
}

/** Every Offer / AggregateOffer in the page's JSON-LD blocks, in document order. */
export function findJsonLdOffers(html: string): JsonLdOffer[] {
  const $ = load(html);
  const offers: JsonLdOffer[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== 'object' || node === null) return;
    const obj = node as Record<string, unknown>;
    // Offer and AggregateOffer carry price/lowPrice; nested Products are found by recursion.
    if ('price' in obj || 'lowPrice' in obj) {
      offers.push({
        price: scalar(obj.price),
        lowPrice: scalar(obj.lowPrice),
        priceCurrency: typeof obj.priceCurrency === 'string' ? obj.priceCurrency : undefined,
      });
    }
    for (const [key, value] of Object.entries(obj)) if (key !== '@context') visit(value);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()));
    } catch {
      // Malformed JSON-LD is common in the wild; skip the block.
    }
  });
  return offers;
}

function scalar(value: unknown): string | number | undefined {
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}
