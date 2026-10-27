import type { CurrencyCode } from '../types';

/**
 * Currency markers, most specific first: "US$" and "R$" must win over a bare "$".
 * `family` marks symbols shared by several currencies; a caller-supplied hint from the
 * same family overrides the default.
 */
interface CurrencyMarker {
  pattern: RegExp;
  code: CurrencyCode | null;
  family?: readonly CurrencyCode[];
}

const DOLLARS = ['USD', 'CAD', 'AUD', 'NZD', 'HKD', 'SGD', 'MXN', 'TWD'] as const;
const YEN_YUAN = ['JPY', 'CNY'] as const;
const KRONOR = ['SEK', 'NOK', 'DKK', 'ISK'] as const;

const MARKERS: readonly CurrencyMarker[] = [
  { pattern: /US\$/, code: 'USD' },
  { pattern: /(?:CA|C)\$/, code: 'CAD' },
  { pattern: /(?:AU|A)\$/, code: 'AUD' },
  { pattern: /NZ\$/, code: 'NZD' },
  { pattern: /HK\$/, code: 'HKD' },
  { pattern: /S\$/, code: 'SGD' },
  { pattern: /MX\$/, code: 'MXN' },
  { pattern: /NT\$/, code: 'TWD' },
  { pattern: /R\$/, code: 'BRL' },
  { pattern: /CN¥|RMB|元/, code: 'CNY' },
  { pattern: /\$/, code: 'USD', family: DOLLARS },
  { pattern: /€/, code: 'EUR' },
  { pattern: /£/, code: 'GBP' },
  { pattern: /[¥￥]|円/, code: 'JPY', family: YEN_YUAN },
  { pattern: /₹|\bRs\.?(?=\s*\d)/, code: 'INR' },
  { pattern: /₩/, code: 'KRW' },
  { pattern: /₽/, code: 'RUB' },
  { pattern: /₺/, code: 'TRY' },
  { pattern: /₪/, code: 'ILS' },
  { pattern: /฿/, code: 'THB' },
  { pattern: /₫/, code: 'VND' },
  { pattern: /₱/, code: 'PHP' },
  { pattern: /zł/i, code: 'PLN' },
  { pattern: /Kč/, code: 'CZK' },
  { pattern: /\bkr\.?/i, code: null, family: KRONOR },
];

/** ISO codes we accept when written out ("USD 12", "12 EUR"). */
const ISO_CODES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'ISK',
  'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'INR', 'KRW', 'BRL', 'MXN', 'HKD', 'SGD', 'TWD', 'THB',
  'ZAR', 'TRY', 'ILS', 'AED', 'SAR', 'RUB', 'VND', 'PHP', 'IDR', 'MYR', 'ARS', 'CLP', 'COP',
]);

export interface CurrencyMatch {
  code: CurrencyCode | null;
  index: number;
  length: number;
}

/** Finds every currency marker in `text`, resolving shared symbols against `hint`. */
export function findCurrencyMarkers(text: string, hint?: CurrencyCode): CurrencyMatch[] {
  const matches: CurrencyMatch[] = [];
  const taken: boolean[] = new Array<boolean>(text.length).fill(false);

  const claim = (index: number, length: number, code: CurrencyCode | null): void => {
    for (let i = index; i < index + length; i++) if (taken[i]) return;
    for (let i = index; i < index + length; i++) taken[i] = true;
    matches.push({ code, index, length });
  };

  for (const m of text.matchAll(/\b[A-Z]{3}\b/g)) {
    if (ISO_CODES.has(m[0])) claim(m.index, m[0].length, m[0]);
  }
  for (const marker of MARKERS) {
    const global = new RegExp(marker.pattern.source, `${marker.pattern.flags}g`);
    for (const m of text.matchAll(global)) {
      const code = hint && marker.family?.includes(hint) ? hint : marker.code;
      claim(m.index, m[0].length, code);
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}
