const MINUTE = 60_000;

/**
 * Time domain fitted to the data: the span of all checks plus 6% padding on each side, so a
 * burst of checks fills the plot instead of bunching in the middle of a fixed window. A single
 * check (zero span) gets a small symmetric window around it.
 */
export function timeDomain(times: readonly number[], padRatio = 0.06, minSpanMs = 10 * MINUTE): [number, number] {
  if (times.length === 0) throw new Error('timeDomain needs at least one time');
  const lo = Math.min(...times);
  const hi = Math.max(...times);
  const span = hi - lo;
  if (span === 0) return [lo - minSpanMs / 2, hi + minSpanMs / 2];
  const pad = span * padRatio;
  return [lo - pad, hi + pad];
}

export interface XY {
  t: number;
  price: number;
}

/**
 * Step-after path: a price holds until the next observation replaces it, which is how a listed
 * price actually behaves. Diagonal segments would imply prices we never saw.
 */
export function stepAfterPath(points: readonly XY[], x: (t: number) => number, y: (v: number) => number): string {
  return points
    .map((p, i) => (i === 0 ? `M${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}` : `H${x(p.t).toFixed(1)}V${y(p.price).toFixed(1)}`))
    .join('');
}

/** Tick spacing candidates for the time axis, from one minute to a month. */
export const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 180, 360, 720, 1440, 2880, 10080, 20160, 43200].map((m) => m * MINUTE);
