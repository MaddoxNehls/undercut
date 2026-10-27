import type { CollectorKind, ObservationStatus } from '../types';

/**
 * Learned routing. Every domain starts on `cloud` (cheap, always on). Evidence moves it:
 *
 *   cloud ──(block rate over the last `window` cloud attempts > enterLocalAbove,
 *            with at least `minSamples` attempts)──▶ local
 *   local ──(the last `probeSuccessesToReturn` cloud probes all succeeded)──▶ cloud
 *
 * While on `local`, the scheduler sends a shadow "probe" job to the cloud every
 * `probeEveryMs`, in addition to the normal local job, so re-probing never costs the user a
 * data point. Entering needs a sustained block rate; leaving needs consecutive clean probes.
 * The asymmetry is deliberate hysteresis: one lucky request must not flip a domain back.
 */
export interface RoutingConfig {
  window: number;
  minSamples: number;
  enterLocalAbove: number;
  probeEveryMs: number;
  probeSuccessesToReturn: number;
}

export const DEFAULT_ROUTING: RoutingConfig = {
  window: 10,
  minSamples: 4,
  enterLocalAbove: 0.5,
  probeEveryMs: 6 * 60 * 60 * 1000,
  probeSuccessesToReturn: 2,
};

export interface DomainRouteState {
  route: CollectorKind;
  changedAt: Date;
  lastProbeAt: Date | null;
}

export interface CloudAttempt {
  status: ObservationStatus;
  at: Date;
}

export interface RouteTransition {
  route: CollectorKind;
  reason: string;
}

/** Block rate of a window of attempts. Parse errors are not blocks: the page loaded. */
export function blockRate(attempts: readonly CloudAttempt[]): number {
  if (attempts.length === 0) return 0;
  return attempts.filter((a) => a.status === 'blocked').length / attempts.length;
}

/**
 * Re-evaluates a domain's route after new evidence. `cloudAttempts` are the domain's most recent
 * cloud observations, newest first. Returns null when the route should stay as it is.
 */
export function nextRoute(
  state: DomainRouteState,
  cloudAttempts: readonly CloudAttempt[],
  config: RoutingConfig = DEFAULT_ROUTING,
): RouteTransition | null {
  if (state.route === 'cloud') {
    const window = cloudAttempts.slice(0, config.window);
    const rate = blockRate(window);
    if (window.length >= config.minSamples && rate > config.enterLocalAbove) {
      return {
        route: 'local',
        reason: `cloud blocked on ${Math.round(rate * 100)}% of the last ${window.length} attempts`,
      };
    }
    return null;
  }

  const probes = cloudAttempts.filter((a) => a.at > state.changedAt).slice(0, config.probeSuccessesToReturn);
  if (probes.length === config.probeSuccessesToReturn && probes.every((p) => p.status !== 'blocked')) {
    return { route: 'cloud', reason: `${probes.length} consecutive cloud probes succeeded` };
  }
  return null;
}

/** Whether a locally-routed domain is due for a cloud probe. */
export function isProbeDue(state: DomainRouteState, now: Date, config: RoutingConfig = DEFAULT_ROUTING): boolean {
  if (state.route !== 'local') return false;
  const since = state.lastProbeAt ?? state.changedAt;
  return now.getTime() - since.getTime() >= config.probeEveryMs;
}
