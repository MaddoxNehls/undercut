import { formatPrice, type PriceKind, type PricePeriod } from '@undercut/core';

const PERIOD_SUFFIX: Record<PricePeriod, string> = {
  night: '/night',
  day: '/day',
  week: '/week',
  month: '/mo',
  year: '/yr',
  person: '/person',
};

interface PriceInput {
  price: number;
  currency: string | null;
  kind?: PriceKind | null;
  max?: number | null;
  period?: PricePeriod | null;
}

/** A price split for display: `from` + `$10.00–$20.00` + `/night`. */
export function priceParts(input: PriceInput): { prefix: string; amount: string; suffix: string } {
  const base = formatPrice(input.price, input.currency);
  const amount = input.kind === 'range' && input.max != null ? `${base}–${formatPrice(input.max, input.currency)}` : base;
  return {
    prefix: input.kind === 'from' ? 'from' : '',
    amount,
    suffix: input.period ? PERIOD_SUFFIX[input.period] : '',
  };
}

/** "$1,299.00", "from $1,299.00/night", "$10.00–$20.00". */
export function describePrice(input: PriceInput): string {
  const { prefix, amount, suffix } = priceParts(input);
  return `${prefix ? `${prefix} ` : ''}${amount}${suffix}`;
}

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "3 minutes ago", "in 2 hours", "just now". */
export function relativeTime(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime();
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

export function intervalLabel(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? 'daily' : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? 'hourly' : `every ${minutes / 60} hours`;
  return `every ${minutes} min`;
}

export function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
