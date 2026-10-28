import { describe, expect, it } from 'vitest';
import { stepAfterPath, timeDomain } from '../lib/chart-scale';

const MIN = 60_000;

describe('timeDomain', () => {
  it('fits a two-minute burst instead of centering it in an hour', () => {
    const [x0, x1] = timeDomain([0, 1 * MIN, 2 * MIN]);
    expect(x1 - x0).toBeCloseTo(2 * MIN * 1.12);
    expect(x0).toBeCloseTo(-0.12 * MIN);
  });

  it('gives a single check a small window', () => {
    expect(timeDomain([1000])).toEqual([1000 - 5 * MIN, 1000 + 5 * MIN]);
  });
});

describe('stepAfterPath', () => {
  it('holds each price until the next observation', () => {
    const id = (v: number) => v;
    expect(stepAfterPath([{ t: 0, price: 10 }, { t: 5, price: 8 }, { t: 9, price: 8 }], id, id)).toBe('M0.0,10.0H5.0V8.0H9.0V8.0');
  });
});
