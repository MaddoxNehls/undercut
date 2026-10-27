import type { CollectorKind, CurrencyCode, ObservationStatus } from '../types';

/** Emitted after an observation is committed. M4's alert engine subscribes here. */
export interface ObservationRecorded {
  observationId: string;
  watchId: string;
  variantId: string;
  status: ObservationStatus;
  price: number | null;
  currency: CurrencyCode | null;
  asOf: Date;
  collectorKind: CollectorKind;
}

/**
 * Post-commit side effects of a new observation. Hooks run after the transaction, so a slow or
 * failing hook can never roll back (or double-record) collected data.
 */
export interface ObservationHook {
  readonly name: string;
  onObservation(event: ObservationRecorded): Promise<void>;
}

/** Alert rules M4 will evaluate (spec: below target, drop by X%, new all-time low). */
export type AlertRule =
  | { kind: 'below_target'; target: number }
  | { kind: 'drop_pct'; pct: number }
  | { kind: 'all_time_low' };

export interface AlertCandidate {
  rule: AlertRule;
  price: number;
  currency: CurrencyCode | null;
  message: string;
}

/**
 * Evaluation contract for M4: given an observation and the variant's history, which rules fire.
 * Re-alert suppression is applied afterwards with `shouldRealert` from the hysteresis module.
 */
export interface AlertEvaluator {
  evaluate(event: ObservationRecorded, rules: readonly AlertRule[]): Promise<AlertCandidate[]>;
}
