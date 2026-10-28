import { parsePrice, type CandidateSource, type DigestNode, type ExtractionRule, type ParseOptions, type PriceCandidate, type PriceMeaning } from '@undercut/core';
import { extractPrice, findJsonLdOffers } from '@undercut/core/extract';
import { load } from 'cheerio';
import { cssPath, PRICE_TEXT } from './digest';

/** Runs a rule against captured HTML: the same code path a collector uses on every check. */
export async function validateRule(html: string, rule: ExtractionRule, parse: ParseOptions): Promise<Pick<PriceCandidate, 'price' | 'text'>> {
  const result = await extractPrice({ requestedUrl: '', finalUrl: '', httpStatus: 200, html }, rule, parse);
  return result.status === 'ok' ? { price: result.price, text: result.text } : { price: null };
}

/** Infers what a price means from the words and markup around it. */
export function inferMeaning(context: { text: string; label?: string | undefined; hints: readonly string[]; struck: boolean }): PriceMeaning {
  const words = `${context.label ?? ''} ${context.hints.join(' ')}`.toLowerCase();
  if (context.struck || /\b(was|before|orig|original|regular|list|old|strike|rrp|compare)/.test(words)) return 'was';
  if (/\btotal\b|\bin total\b|for \d+ nights|grand/.test(`${words} ${context.text.toLowerCase()}`)) return 'total';
  const parsed = parsePrice(context.text);
  if (parsed?.period || /\bper\b|nightly|\/\s*(night|nt|person|month|mo)\b|each/.test(`${words} ${context.text.toLowerCase()}`)) return 'per_unit';
  return 'current';
}

const SOURCE_RANK: Record<CandidateSource, number> = { 'json-ld': 0, microdata: 1, opengraph: 2, llm: 3, 'class-pattern': 4 };
const MEANING_RANK: Record<PriceMeaning, number> = { current: 0, per_unit: 1, total: 2, was: 3 };

/** Validated first, then current prices, then the most trustworthy source, then confidence. */
export function rankCandidates(candidates: readonly PriceCandidate[]): PriceCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      Number(b.price !== null) - Number(a.price !== null) ||
      MEANING_RANK[a.meaning] - MEANING_RANK[b.meaning] ||
      SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
      b.confidence - a.confidence,
  );
}

/**
 * Cheap, deterministic candidates that need no LLM: schema.org JSON-LD, microdata, OpenGraph
 * product tags, and elements whose class or id says "price". All are validated before return.
 */
export async function heuristicCandidates(html: string, parse: ParseOptions = {}): Promise<PriceCandidate[]> {
  const $ = load(html);
  const proposals: Omit<PriceCandidate, 'price' | 'text'>[] = [];

  const offers = findJsonLdOffers(html);
  if (offers.some((o) => o.price !== undefined)) {
    proposals.push({ rule: { kind: 'json-ld', field: 'price' }, source: 'json-ld', meaning: 'current', confidence: 0.95 });
  } else if (offers.some((o) => o.lowPrice !== undefined)) {
    proposals.push({ rule: { kind: 'json-ld', field: 'lowPrice' }, source: 'json-ld', meaning: 'current', confidence: 0.85 });
  }

  const micro = $('[itemprop="price"]').first();
  if (micro.length > 0) {
    const rule: ExtractionRule = micro.attr('content') !== undefined
      ? { kind: 'selector', selector: '[itemprop="price"]', attribute: 'content' }
      : { kind: 'selector', selector: '[itemprop="price"]' };
    proposals.push({ rule, source: 'microdata', meaning: 'current', confidence: 0.9 });
  }

  for (const property of ['product:price:amount', 'og:price:amount']) {
    if ($(`meta[property="${property}"]`).length > 0) {
      proposals.push({ rule: { kind: 'selector', selector: `meta[property="${property}"]`, attribute: 'content' }, source: 'opengraph', meaning: 'current', confidence: 0.85 });
      break;
    }
  }
  const ogCurrency = $('meta[property="product:price:currency"], meta[property="og:price:currency"]').first().attr('content');

  const seen = new Set<string>();
  $('[class*="price" i], [id*="price" i], [class*="amount" i]').each((_, node) => {
    const el = $(node);
    const text = el.text().replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80 || !PRICE_TEXT.test(text)) return;
    if (el.find('[class*="price" i], [class*="amount" i]').toArray().some((c) => PRICE_TEXT.test($(c).text()))) return;
    const selector = cssPath($, el);
    if (seen.has(selector) || seen.size >= 6) return;
    seen.add(selector);
    const struck = /^(del|s|strike)$/.test(node.tagName) || /strike|was|old|original|regular/i.test(el.attr('class') ?? '');
    const meaning = inferMeaning({ text, label: el.prev().text().trim().slice(0, 60), hints: [el.attr('class') ?? ''], struck });
    proposals.push({ rule: { kind: 'selector', selector }, source: 'class-pattern', meaning, confidence: meaning === 'current' ? 0.6 : 0.45 });
  });

  const parseWith = ogCurrency && !parse.currency ? { ...parse, currency: ogCurrency } : parse;
  const validated = await Promise.all(proposals.map(async (p) => ({ ...p, ...(await validateRule(html, p.rule, parseWith)) })));
  return validated.filter((c) => c.price !== null);
}

/**
 * Heuristics are trusted when they point at one price: structured data whose current values
 * agree, or exactly one distinct current price from class patterns. Anything else is ambiguous
 * and worth an LLM call.
 */
export function ambiguity(candidates: readonly PriceCandidate[]): string | null {
  const current = candidates.filter((c) => c.price !== null && c.meaning === 'current');
  const structured = current.filter((c) => c.source !== 'class-pattern' && c.source !== 'llm');
  const pool = structured.length > 0 ? structured : current;
  if (pool.length === 0) return 'no current price found by structured data or class patterns';
  const amounts = [...new Set(pool.map((c) => c.price!.amount))];
  const spread = (Math.max(...amounts) - Math.min(...amounts)) / Math.max(...amounts);
  if (amounts.length > 1 && spread > 0.005) return `heuristics disagree: ${amounts.join(' vs ')}`;
  return null;
}

/** Candidates from digest nodes, validated against the node text (used where only the digest exists). */
export function candidateFromNode(node: DigestNode, meaning: PriceMeaning, source: CandidateSource, confidence: number, parse: ParseOptions, rationale?: string): PriceCandidate {
  const price = parsePrice(node.text, parse);
  return {
    rule: { kind: 'selector', selector: node.css },
    source,
    meaning,
    confidence,
    price,
    text: node.text,
    ...(rationale ? { rationale } : {}),
  };
}
