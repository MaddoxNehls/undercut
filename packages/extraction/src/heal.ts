import type { PriceCandidate, PriceMeaning } from '@undercut/core';
import { rankCandidates } from './candidates';

export interface HealPolicy {
  /** Consecutive parse errors that trigger re-extraction. */
  errorThreshold: number;
  /** Auto-accept only if the new value is within this fraction of the last known price. */
  maxDrift: number;
}

export const DEFAULT_HEAL_POLICY: HealPolicy = { errorThreshold: 3, maxDrift: 0.15 };

export type HealDecision =
  | { action: 'apply'; candidate: PriceCandidate; drift: number; reason: string }
  | { action: 'review'; candidate: PriceCandidate | null; reason: string };

/**
 * Whether a re-derived selector may replace the old one without asking. A layout change
 * shouldn't change the price, so the new value must be close to the last known one AND mean
 * the same thing (a "was" price is often near the current one, so meaning matters). Anything
 * else is flagged for review rather than silently tracking the wrong number.
 */
export function decideHeal(
  input: { lastKnownPrice: number | null; meaning: PriceMeaning; candidates: readonly PriceCandidate[] },
  policy: HealPolicy = DEFAULT_HEAL_POLICY,
): HealDecision {
  const [best] = rankCandidates(input.candidates.filter((c) => c.price !== null && c.meaning === input.meaning));
  if (!best) return { action: 'review', candidate: rankCandidates(input.candidates)[0] ?? null, reason: `no candidate with meaning "${input.meaning}"` };
  if (input.lastKnownPrice === null) return { action: 'review', candidate: best, reason: 'no previous price to compare against' };

  const value = best.price!.amount;
  const drift = Math.abs(value - input.lastKnownPrice) / input.lastKnownPrice;
  const pct = `${(drift * 100).toFixed(1)}%`;
  if (drift <= policy.maxDrift) {
    return { action: 'apply', candidate: best, drift, reason: `new value ${value} is within ${pct} of the last known ${input.lastKnownPrice}` };
  }
  return { action: 'review', candidate: best, reason: `new value ${value} differs from the last known ${input.lastKnownPrice} by ${pct}` };
}
