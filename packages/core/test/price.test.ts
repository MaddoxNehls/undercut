import { describe, expect, it } from 'vitest';
import { formatPrice, parsePrice, toNumber, type ParseOptions, type ParsedPrice } from '../src/index';

type Case = [input: string, expected: Partial<ParsedPrice> | null, options?: ParseOptions];

const cases: Case[] = [
  // Plain amounts and currency symbols
  ['$1,299', { amount: 1299, currency: 'USD', kind: 'exact' }],
  ['$19.99', { amount: 19.99, currency: 'USD' }],
  ['£51.77', { amount: 51.77, currency: 'GBP' }],
  ['€ 12,50', { amount: 12.5, currency: 'EUR' }],
  ['1.299,00 €', { amount: 1299, currency: 'EUR' }],
  ['1 299,99 €', { amount: 1299.99, currency: 'EUR' }],
  ['1 299,99 €', { amount: 1299.99, currency: 'EUR' }],
  ["CHF 1'299.50", { amount: 1299.5, currency: 'CHF' }],
  ['¥12,800', { amount: 12800, currency: 'JPY' }],
  ['12,800円', { amount: 12800, currency: 'JPY' }],
  ['₹1,29,999', { amount: 129999, currency: 'INR' }],
  ['Rs. 2,499', { amount: 2499, currency: 'INR' }],
  ['R$ 1.234,56', { amount: 1234.56, currency: 'BRL' }],
  ['US$ 99', { amount: 99, currency: 'USD' }],
  ['CA$45.00', { amount: 45, currency: 'CAD' }],
  ['USD 1,200.00', { amount: 1200, currency: 'USD' }],
  ['1200 EUR', { amount: 1200, currency: 'EUR' }],
  ['49,90 zł', { amount: 49.9, currency: 'PLN' }],
  ['₩35,000', { amount: 35000, currency: 'KRW' }],
  ['1.299 kr', { amount: 1299, currency: 'SEK' }, { currency: 'SEK' }],
  ['299 kr', { amount: 299, currency: null }],

  // Ambiguous symbols resolved by the hint
  ['$89', { amount: 89, currency: 'CAD' }, { currency: 'CAD' }],
  ['¥88', { amount: 88, currency: 'CNY' }, { currency: 'CNY' }],

  // Separators: three trailing digits mean grouping, unless the locale says decimal
  ['1,299', { amount: 1299, currency: null }],
  ['1.299', { amount: 1299 }],
  ['1,299', { amount: 1.299 }, { locale: 'de-DE' }],
  ['1.299', { amount: 1299 }, { locale: 'de-DE' }],
  ['0.125', { amount: 0.125 }],
  ['12,5', { amount: 12.5 }],
  ['1,234,567.89', { amount: 1234567.89 }],
  ['1.234.567,89', { amount: 1234567.89 }],

  // No currency in the text: fall back to the hint
  ['51.77', { amount: 51.77, currency: 'GBP' }, { currency: 'GBP' }],

  // "from" prices and periods
  ['from $1,299/night', { amount: 1299, currency: 'USD', kind: 'from', period: 'night' }],
  ['From US$1,299 per night', { amount: 1299, currency: 'USD', kind: 'from', period: 'night' }],
  ['Starting at $49/mo', { amount: 49, kind: 'from', period: 'month' }],
  ['ab 1.299 € / Nacht', { amount: 1299, currency: 'EUR', kind: 'from', period: 'night' }],
  ['$120 per person', { amount: 120, period: 'person' }],
  ['$465/nt', { amount: 465, period: 'night' }],

  // Ranges keep the low end as the amount
  ['$10 - $20', { amount: 10, max: 20, kind: 'range', currency: 'USD' }],
  ['$10–20', { amount: 10, max: 20, kind: 'range' }],
  ['€100 to €150 per night', { amount: 100, max: 150, kind: 'range', period: 'night' }],

  // Noise numbers are ignored when a price is anchored by a currency
  ['2 adults · $1,299 total', { amount: 1299, currency: 'USD' }],
  ['Save 20% — now $79.99', { amount: 79.99 }],
  ['Price: £51.77 (In stock: 22 available)', { amount: 51.77, currency: 'GBP' }],

  // Degenerate inputs
  ['Free', { amount: 0, kind: 'exact' }],
  ['Sold out', null],
  ['', null],
];

describe('parsePrice', () => {
  it.each(cases)('%s', (input, expected, options) => {
    const result = parsePrice(input, options);
    if (expected === null) expect(result).toBeNull();
    else expect(result).toMatchObject(expected);
  });

  it('does not invent a range when the second number is lower', () => {
    expect(parsePrice('$20 - $15')).toMatchObject({ amount: 20, kind: 'exact' });
  });
});

describe('toNumber', () => {
  it.each([
    ['1,299.00', undefined, 1299],
    ['1.299,00', undefined, 1299],
    ['999', undefined, 999],
    ['1.299', ',' as const, 1299],
    ['1,299', ',' as const, 1.299],
  ])('%s (locale decimal %s) -> %d', (raw, decimal, expected) => {
    expect(toNumber(raw, decimal)).toBe(expected);
  });
});

describe('formatPrice', () => {
  it('formats known currencies and tolerates unknown codes', () => {
    expect(formatPrice(1299, 'USD')).toBe('$1,299.00');
    expect(formatPrice(51.77, 'GBP')).toBe('£51.77');
    expect(formatPrice(12, null)).toBe('12');
    expect(formatPrice(5, 'NOT_A_CODE')).toBe('NOT_A_CODE 5.00');
  });
});
