import type { ObservationHook } from '@undercut/core';

/**
 * Post-commit observation hooks. M4 registers the alert engine here (rule evaluation, then
 * `shouldRealert` hysteresis, then channel delivery). Empty in M1-M2.
 */
export const observationHooks: readonly ObservationHook[] = [];
