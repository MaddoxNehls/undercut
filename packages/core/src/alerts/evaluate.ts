import { confirmedPrice, DEFAULT_REALERT, shouldRealert, type PricePoint, type RealertPolicy } from '../hysteresis/hysteresis';
import type { AlertRule } from './hooks';

export interface AlertPolicy extends RealertPolicy {
  /** Consecutive observations that must agree before a price level counts (debounce). */
  confirmations: number;
  /** Relative band within which observations "agree". */
  tolerance: number;
  /** Observations in the trailing window for the drop-from-median rule. */
  medianWindow: number;
}

export const DEFAULT_ALERT_POLICY: AlertPolicy = { ...DEFAULT_REALERT, confirmations: 2, tolerance: 0.005, medianWindow: 20 };

export interface RuleState {
  lastAlert: PricePoint | null;
  lastQualifiedAt: Date | null;
}

export interface RuleEvaluation {
  /** The debounced price level, or null while observations still disagree. */
  level: number | null;
  qualifies: boolean;
  fire: boolean;
  message: string;
}

/**
 * The stable (debounced) price after each observation, oldest first. A level is adopted only once
 * `confirmations` consecutive observations agree within `tolerance`; there is no bootstrap from a
 * single reading, so a lone outlier, even the very first one, never becomes a level.
 */
export function stableLevels(pricesOldestFirst: readonly number[], policy: Pick<AlertPolicy, 'confirmations' | 'tolerance'>): (number | null)[] {
  const levels: (number | null)[] = [];
  let stable: number | null = null;
  for (let i = 0; i < pricesOldestFirst.length; i++) {
    const recent = pricesOldestFirst.slice(0, i + 1).reverse();
    const head = recent.slice(0, policy.confirmations);
    const agree = head.length === policy.confirmations && head.every((p) => Math.abs(p - head[0]!) <= Math.abs(head[0]!) * policy.tolerance);
    stable = stable === null ? (agree ? head[0]! : null) : confirmedPrice({ recent, stable, confirmations: policy.confirmations, tolerance: policy.tolerance });
    levels.push(stable);
  }
  return levels;
}

/**
 * Evaluates one rule on a variant's price history (oldest first, the newest observation last).
 *
 *  1. Debounce: work on the confirmed level, never on a single reading.
 *  2. Qualify: below target / dropped ≥ X% from the trailing median / below every previous level.
 *  3. Fire only if `shouldRealert` agrees: first alert, a further drop of at least `step`, or the
 *     rule re-armed after `rearmAfterMs` without qualifying.
 */
export function evaluateRule(
  rule: AlertRule,
  history: readonly PricePoint[],
  state: RuleState,
  policy: AlertPolicy = DEFAULT_ALERT_POLICY,
  format: (amount: number) => string = String,
): RuleEvaluation {
  const latest = history[history.length - 1];
  const levels = stableLevels(history.map((p) => p.price), policy);
  const level = levels[levels.length - 1] ?? null;
  if (!latest || level === null) return { level: null, qualifies: false, fire: false, message: 'waiting for a confirmed price' };

  // Compare against what was known before the observations that confirmed this level.
  const before = history.slice(0, Math.max(0, history.length - policy.confirmations)).map((p) => p.price);
  let qualifies: boolean;
  let message: string;
  switch (rule.kind) {
    case 'below_target':
      qualifies = level <= rule.target;
      message = `${format(level)} is at or below your target of ${format(rule.target)}`;
      break;
    case 'drop_pct': {
      const median = medianOf(before.slice(-policy.medianWindow));
      qualifies = median !== null && level <= median * (1 - rule.pct / 100);
      message = median === null ? 'no history yet' : `${format(level)} is ${(((median - level) / median) * 100).toFixed(1)}% below the recent median of ${format(median)}`;
      break;
    }
    case 'all_time_low': {
      const previousLow = before.length > 0 ? Math.min(...before) : null;
      qualifies = previousLow !== null && level < previousLow;
      message = `${format(level)} is a new all-time low (previous ${previousLow === null ? 'none' : format(previousLow)})`;
      break;
    }
  }
  const fire = qualifies && shouldRealert({ lastAlert: state.lastAlert, lastQualifiedAt: state.lastQualifiedAt, current: { price: level, at: latest.at } }, policy);
  return { level, qualifies, fire, message };
}

export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface QuietHours {
  /** "22:00" */
  start: string;
  /** "07:00"; may be earlier than start (wraps past midnight). */
  end: string;
  timeZone: string;
}

/**
 * When a notification may go out. Inside quiet hours, delivery is deferred to the end of the
 * window rather than dropped: the alert still matters in the morning.
 */
export function deliverAt(now: Date, quiet: QuietHours | null): Date {
  if (!quiet) return now;
  const toMinutes = (hhmm: string) => {
    const [h = 0, m = 0] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: quiet.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const local = Number(parts.find((p) => p.type === 'hour')?.value) * 60 + Number(parts.find((p) => p.type === 'minute')?.value);
  const start = toMinutes(quiet.start);
  const end = toMinutes(quiet.end);
  const inside = start <= end ? local >= start && local < end : local >= start || local < end;
  if (!inside) return now;
  const wait = (end - local + 1440) % 1440;
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000 + wait * 60_000);
}
