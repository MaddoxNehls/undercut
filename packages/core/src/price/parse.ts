import type { CurrencyCode, ParseOptions, ParsedPrice, PricePeriod } from '../types';
import { findCurrencyMarkers, type CurrencyMatch } from './currency';

/**
 * Number shapes, tried in order:
 *  1. Indian lakh grouping: 1,29,999.00
 *  2. 3-digit grouping with comma, dot, space, or apostrophe: 1,299.00 / 1.299,00 / 1 299,00 / 1'299.00
 *  3. Plain: 1299 / 12.50 / 12,50
 */
const NUMBER = /\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d+)?|\d{1,3}(?:[ \u00A0\u202F.,']\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

const FROM_WORDS = /(?:^|\s)(?:from|starting at|starts at|as low as|ab|dès|à partir de|desde|a partir de|da)\s*$/i;
const RANGE_GLUE = /^\s*(?:-|to|bis|à|a)\s*$/i;
const PERIODS: ReadonlyArray<[RegExp, PricePeriod]> = [
  [/^(?:night|nights|nightly|nt|noche|nuit|nacht)\b/i, 'night'],
  [/^(?:day|daily)\b/i, 'day'],
  [/^(?:week|wk|weekly)\b/i, 'week'],
  [/^(?:month|mo|monthly|mth)\b/i, 'month'],
  [/^(?:year|yr|annually|annum)\b/i, 'year'],
  [/^(?:person|pp|guest|pax|adult)\b/i, 'person'],
];

interface NumberToken {
  raw: string;
  value: number;
  start: number;
  end: number;
}

/**
 * Parses a human-written price: "$1,299", "from $1,299/night", "1.299,00 €", "$10 \u2013 $20".
 * Returns null when the text holds no number. The first currency-anchored number wins;
 * stray numbers ("for 2 adults", "20% off") are ignored when a currency is present.
 */
export function parsePrice(input: string, options: ParseOptions = {}): ParsedPrice | null {
  const text = normalize(input);
  if (/^\s*free\s*$/i.test(text)) return { amount: 0, currency: options.currency ?? null, kind: 'exact' };

  const currencies = findCurrencyMarkers(text, options.currency);
  const tokens = numberTokens(text, options.locale).filter((t) => !isPercentage(text, t));
  if (tokens.length === 0) return null;

  const anchored = tokens.filter((t) => nearestCurrency(t, currencies, text) !== undefined);
  const candidates = anchored.length > 0 ? anchored : tokens;
  const first = candidates[0];
  if (!first) return null;

  const anchor = nearestCurrency(first, currencies, text);
  const currency = anchor?.code ?? currencies[0]?.code ?? options.currency ?? null;
  const upper = rangePartner(text, first, tokens);
  const tail = text.slice((upper ?? first).end);
  // Words before the price (and before a leading currency symbol) decide "from $X".
  const lead = text.slice(0, anchor && anchor.index < first.start ? anchor.index : first.start);

  const price: ParsedPrice = {
    amount: first.value,
    currency,
    kind: upper ? 'range' : FROM_WORDS.test(lead) ? 'from' : 'exact',
  };
  if (upper) price.max = upper.value;
  const period = periodAfter(tail);
  if (period) price.period = period;
  return price;
}

function normalize(input: string): string {
  return input
    .replace(/[\u00A0\u202F\u2009]/g, ' ')
    .replace(/[\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberTokens(text: string, locale?: string): NumberToken[] {
  const tokens: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const value = toNumber(m[0], decimalSeparator(locale));
    if (Number.isFinite(value)) tokens.push({ raw: m[0], value, start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/**
 * Decides which separator is the decimal point.
 * Both present: the last one is decimal. One present once: decimal unless exactly three digits
 * follow (then it's grouping, "1,299"), and the page locale can override that.
 */
export function toNumber(raw: string, localeDecimal?: '.' | ','): number {
  const compact = raw.replace(/[ \u00A0\u202F']/g, '');
  const lastDot = compact.lastIndexOf('.');
  const lastComma = compact.lastIndexOf(',');

  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    return Number(compact.split(group).join('').replace(decimal, '.'));
  }

  const sep = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null;
  if (!sep) return Number(compact);

  const parts = compact.split(sep);
  if (parts.length > 2) return Number(parts.join(''));

  const [intPart = '', fracPart = ''] = parts;
  const looksGrouped = fracPart.length === 3 && intPart !== '0';
  const isDecimal = looksGrouped ? localeDecimal === sep : true;
  return Number(isDecimal ? `${intPart}.${fracPart}` : `${intPart}${fracPart}`);
}

function decimalSeparator(locale?: string): '.' | ',' | undefined {
  if (!locale) return undefined;
  try {
    const part = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal');
    return part?.value === ',' ? ',' : '.';
  } catch {
    return undefined;
  }
}

function isPercentage(text: string, token: NumberToken): boolean {
  return /^\s?%/.test(text.slice(token.end));
}

/** A currency marker within a few characters (and no other digits) of the number. */
function nearestCurrency(token: NumberToken, currencies: CurrencyMatch[], text: string): CurrencyMatch | undefined {
  const MAX_GAP = 3;
  let best: CurrencyMatch | undefined;
  let bestGap = Infinity;
  for (const c of currencies) {
    const gap = c.index + c.length <= token.start ? token.start - (c.index + c.length) : c.index >= token.end ? c.index - token.end : 0;
    const between = c.index >= token.end ? text.slice(token.end, c.index) : text.slice(c.index + c.length, token.start);
    if (gap <= MAX_GAP && !/\d/.test(between) && gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

/** "$10 - $20", "10\u201320 €", "$10 to $20": returns the upper-bound token. */
function rangePartner(text: string, first: NumberToken, tokens: NumberToken[]): NumberToken | undefined {
  const next = tokens.find((t) => t.start >= first.end);
  if (!next) return undefined;
  const glue = text.slice(first.end, next.start).replace(/[^\p{L}\s-]+/gu, ' ');
  return RANGE_GLUE.test(glue) && next.value >= first.value ? next : undefined;
}

function periodAfter(tail: string): PricePeriod | undefined {
  const rest = tail.replace(/^\s*(?:[A-Z]{3}|[^\p{L}\d\s]{1,3})?\s*(?:\/|per\b|a\b|an\b|each\b|par\b|pro\b)?\s*/u, '');
  for (const [pattern, period] of PERIODS) if (pattern.test(rest)) return period;
  return undefined;
}

/** Formats a price for display; tolerant of unknown currency codes. */
export function formatPrice(amount: number, currency: CurrencyCode | null, locale = 'en-US'): string {
  if (!currency) return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(amount);
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
