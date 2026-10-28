import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_POLICY, deliverAt, evaluateRule, stableLevels, type AlertRule, type PricePoint, type RuleState } from '../src/index';

const HOUR = 3_600_000;
const t0 = Date.UTC(2026, 10, 1, 12);

/** Replays a price sequence (hourly) through one rule, carrying rule state like the alert engine does. */
function replay(rule: AlertRule, prices: readonly number[], policy = DEFAULT_ALERT_POLICY): { fired: { price: number; step: number }[] } {
  const history: PricePoint[] = [];
  let state: RuleState = { lastAlert: null, lastQualifiedAt: null };
  const fired: { price: number; step: number }[] = [];
  prices.forEach((price, step) => {
    const at = new Date(t0 + step * HOUR);
    history.push({ price, at });
    const result = evaluateRule(rule, history, state, policy);
    if (result.fire) fired.push({ price: result.level!, step });
    state = {
      lastAlert: result.fire ? { price: result.level!, at } : state.lastAlert,
      lastQualifiedAt: result.qualifies ? at : state.lastQualifiedAt,
    };
  });
  return { fired };
}

const BELOW_500: AlertRule = { kind: 'below_target', target: 500 };

describe('the Cancun ATELIER flapping sequence ($500 target, $25 step)', () => {
  it('606 → 499 → 517 → 491 fires nothing: no two consecutive checks agree, so no level is ever confirmed', () => {
    expect(replay(BELOW_500, [606, 499, 517, 491]).fired).toEqual([]);
  });

  it('without the debounce, the same sequence would have alerted on a $499 that vanished an hour later', () => {
    // 499 qualifies first → alert. 491 qualifies again, but it is only $8 below the alerted $499
    // (< $25 step) and the rule last qualified 2 hours earlier (< 24h re-arm), so no second alert.
    expect(replay(BELOW_500, [606, 499, 517, 491], { ...DEFAULT_ALERT_POLICY, confirmations: 1 }).fired).toEqual([{ price: 499, step: 1 }]);
  });

  it('continuing the sequence: a confirmed $489 alerts once; a confirmed $464 is $25 lower and re-alerts', () => {
    // step 4: 489 agrees with 491 (0.4% < 0.5%) → level 489 ≤ 500 → first alert.
    // step 5: 488 is within tolerance of 489 → level stays 489 → already alerted, no change.
    // steps 6–7: 470 and 466 disagree with their predecessors → level stays 489.
    // step 8: 464 agrees with 466 → new level 464, exactly $25 below 489 → re-alert.
    expect(replay(BELOW_500, [606, 499, 517, 491, 489, 488, 470, 466, 464]).fired).toEqual([
      { price: 489, step: 4 },
      { price: 464, step: 8 },
    ]);
  });

  it('re-arms after a day without qualifying even if the price did not drop by the step', () => {
    const prices = [490, 490, ...Array<number>(30).fill(560), 495, 495];
    expect(replay(BELOW_500, prices).fired.map((f) => f.price)).toEqual([490, 495]);
  });
});

describe('other rules', () => {
  it('drop ≥ X% from the trailing median', () => {
    const rule: AlertRule = { kind: 'drop_pct', pct: 10 };
    expect(replay(rule, [100, 101, 99, 100, 95, 95]).fired).toEqual([]);
    expect(replay(rule, [100, 101, 99, 100, 89, 89]).fired).toEqual([{ price: 89, step: 5 }]);
  });

  it('new all-time low, still subject to the $25 step', () => {
    const rule: AlertRule = { kind: 'all_time_low' };
    expect(replay(rule, [800, 800, 780, 780, 770, 770, 740, 740]).fired.map((f) => f.price)).toEqual([780, 740]);
  });
});

describe('stableLevels', () => {
  it('needs two agreeing observations before adopting any level', () => {
    expect(stableLevels([606, 606, 499, 517, 500, 499], DEFAULT_ALERT_POLICY)).toEqual([null, 606, 606, 606, 606, 499]);
  });
});

describe('quiet hours', () => {
  const quiet = { start: '22:00', end: '07:00', timeZone: 'America/Los_Angeles' };

  it('defers delivery to the end of the window, across midnight, in the user time zone', () => {
    const lateEvening = new Date('2026-11-02T06:30:00Z'); // 22:30 PST
    expect(deliverAt(lateEvening, quiet).toISOString()).toBe('2026-11-02T15:00:00.000Z'); // 07:00 PST
  });

  it('sends immediately outside the window or with no quiet hours', () => {
    const noon = new Date('2026-11-02T20:00:00Z');
    expect(deliverAt(noon, quiet)).toEqual(noon);
    expect(deliverAt(noon, null)).toEqual(noon);
  });
});
