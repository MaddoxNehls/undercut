import type { ObservationHook } from '@undercut/core';
import { alertHook } from '@undercut/db';
import { db } from './db';

/** Post-commit observation hooks: the alert engine evaluates rules and queues deliveries. */
export function observationHooks(): readonly ObservationHook[] {
  return [alertHook(db())];
}
