/**
 * Anti-flap helpers. Travel and retail prices jitter hourly; these keep that noise from
 * turning into alert spam or chart churn.
 */

export interface PricePoint {
  price: number;
  at: Date;
}

export interface RealertPolicy {
  /** Minimum further drop (absolute, in the price's currency) that justifies a new alert. */
  step: number;
  /** After this long without qualifying, the next qualifying price alerts again regardless of step. */
  rearmAfterMs: number;
}

/** The original tracker's rule: re-alert only on a $25 further drop, or after a day of silence. */
export const DEFAULT_REALERT: RealertPolicy = { step: 25, rearmAfterMs: 24 * 60 * 60 * 1000 };

export interface RealertInput {
  /** The last price we alerted at, if any. */
  lastAlert: PricePoint | null;
  /** When the price last satisfied the rule (null if it has not since the last alert). */
  lastQualifiedAt: Date | null;
  current: PricePoint;
}

/**
 * Decides whether a qualifying price (already below target, etc.) should alert again.
 * Never alerted → yes. Dropped by at least `step` since the last alert → yes.
 * Stopped qualifying for `rearmAfterMs` and now qualifies again → yes. Otherwise stay quiet.
 */
export function shouldRealert(input: RealertInput, policy: RealertPolicy = DEFAULT_REALERT): boolean {
  const { lastAlert, lastQualifiedAt, current } = input;
  if (!lastAlert) return true;
  if (lastAlert.price - current.price >= policy.step) return true;
  const quietSince = lastQualifiedAt ?? lastAlert.at;
  return current.at.getTime() - quietSince.getTime() >= policy.rearmAfterMs;
}

export interface StableInput {
  /** Recent prices, newest first. */
  recent: readonly number[];
  /** The currently accepted ("stable") price, or null if none yet. */
  stable: number | null;
  /** How many consecutive agreeing observations confirm a change. */
  confirmations: number;
  /** Prices within this relative band count as "the same" (0.005 = 0.5%). */
  tolerance: number;
}

/**
 * Debounces a price series: a new level is accepted only once `confirmations` consecutive
 * observations agree on it. A single blip (e.g. a flash rate that vanishes next hour) is ignored.
 */
export function confirmedPrice({ recent, stable, confirmations, tolerance }: StableInput): number | null {
  const latest = recent[0];
  if (latest === undefined) return stable;
  // Nothing accepted yet: the first reading bootstraps the series.
  if (stable === null) return latest;
  const head = recent.slice(0, confirmations);
  if (head.length < confirmations || !agree(head, tolerance)) return stable;
  return within(latest, stable, tolerance) ? stable : latest;
}

function agree(values: readonly number[], tolerance: number): boolean {
  const first = values[0];
  return first !== undefined && values.every((v) => within(v, first, tolerance));
}

function within(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= Math.abs(b) * tolerance;
}
