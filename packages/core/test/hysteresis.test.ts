import { describe, expect, it } from 'vitest';
import { confirmedPrice, shouldRealert, type PricePoint } from '../src/index';

const hour = 60 * 60 * 1000;
const t = (h: number) => new Date(Date.UTC(2026, 10, 1) + h * hour);
const point = (price: number, h: number): PricePoint => ({ price, at: t(h) });

describe('shouldRealert (the $25 step rule)', () => {
  it.each([
    ['first time it qualifies', null, null, point(480, 0), true],
    ['same price an hour later', point(480, 0), t(1), point(480, 1), false],
    ['dropped $10', point(480, 0), t(2), point(470, 2), false],
    ['dropped exactly $25', point(480, 0), t(2), point(455, 2), true],
    ['dropped $40', point(480, 0), t(2), point(440, 2), true],
    ['went up', point(480, 0), t(2), point(495, 2), false],
    ['qualifies again after a quiet day', point(480, 0), t(1), point(490, 26), true],
    ['quiet for 23h only', point(480, 0), t(1), point(490, 24), false],
  ] as const)('%s', (_label, lastAlert, lastQualifiedAt, current, expected) => {
    expect(shouldRealert({ lastAlert, lastQualifiedAt, current })).toBe(expected);
  });
});

describe('confirmedPrice (debounce)', () => {
  const opts = { confirmations: 2, tolerance: 0.005 };

  it('bootstraps from the first reading', () => {
    expect(confirmedPrice({ recent: [500], stable: null, ...opts })).toBe(500);
  });

  it('ignores a one-off blip', () => {
    expect(confirmedPrice({ recent: [420, 500, 500], stable: 500, ...opts })).toBe(500);
  });

  it('accepts a new level once confirmed', () => {
    expect(confirmedPrice({ recent: [420, 420, 500], stable: 500, ...opts })).toBe(420);
  });

  it('treats sub-tolerance jitter as no change', () => {
    expect(confirmedPrice({ recent: [500.5, 500.4, 500], stable: 500, ...opts })).toBe(500);
  });

  it('keeps the stable price while readings disagree', () => {
    expect(confirmedPrice({ recent: [450, 430, 500], stable: 500, ...opts })).toBe(500);
  });
});
