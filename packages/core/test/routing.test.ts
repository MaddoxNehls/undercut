import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTING, isProbeDue, nextRoute, type CloudAttempt, type DomainRouteState } from '../src/index';

const t0 = new Date('2026-10-01T00:00:00Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

/** Builds a newest-first attempt list from a comma-separated spec written oldest first. */
function history(spec: string, startMinute = 0): CloudAttempt[] {
  return spec
    .split(',')
    .filter(Boolean)
    .map((s, i) => ({ status: s.trim() as CloudAttempt['status'], at: at(startMinute + i * 10) }))
    .reverse();
}

const onCloud: DomainRouteState = { route: 'cloud', changedAt: t0, lastProbeAt: null };

describe('nextRoute: cloud -> local', () => {
  it('stays on cloud with too few samples, however bad', () => {
    expect(nextRoute(onCloud, history('blocked,blocked,blocked'))).toBeNull();
  });

  it('moves to local once the block rate exceeds the threshold', () => {
    const transition = nextRoute(onCloud, history('ok,blocked,blocked,blocked'));
    expect(transition).toMatchObject({ route: 'local' });
    expect(transition?.reason).toContain('75%');
  });

  it('does not move at exactly the threshold', () => {
    expect(nextRoute(onCloud, history('ok,ok,blocked,blocked'))).toBeNull();
  });

  it('only looks at the most recent window', () => {
    const old = 'blocked,'.repeat(10);
    const recent = 'ok,'.repeat(10);
    expect(nextRoute(onCloud, history(old + recent))).toBeNull();
  });

  it('does not count parse errors as blocks', () => {
    expect(nextRoute(onCloud, history('parse_error,parse_error,parse_error,blocked'))).toBeNull();
  });
});

describe('nextRoute: local -> cloud (hysteresis)', () => {
  const onLocal: DomainRouteState = { route: 'local', changedAt: at(100), lastProbeAt: null };

  it('ignores cloud attempts from before the switch', () => {
    expect(nextRoute(onLocal, history('ok,ok,ok,ok'))).toBeNull();
  });

  it('a single clean probe is not enough', () => {
    expect(nextRoute(onLocal, history('blocked,blocked,blocked,blocked,ok', 70))).toBeNull();
  });

  it('returns to cloud after consecutive clean probes', () => {
    expect(nextRoute(onLocal, history('blocked,ok,ok', 100))).toMatchObject({ route: 'cloud' });
  });

  it('stays local if the latest probe was blocked', () => {
    expect(nextRoute(onLocal, history('ok,ok,blocked', 100))).toBeNull();
  });
});

describe('isProbeDue', () => {
  const local: DomainRouteState = { route: 'local', changedAt: t0, lastProbeAt: null };
  const every = DEFAULT_ROUTING.probeEveryMs;

  it('is never due on cloud', () => {
    expect(isProbeDue(onCloud, new Date(t0.getTime() + 10 * every))).toBe(false);
  });

  it('is due one interval after the switch, then one interval after each probe', () => {
    expect(isProbeDue(local, new Date(t0.getTime() + every - 1))).toBe(false);
    expect(isProbeDue(local, new Date(t0.getTime() + every))).toBe(true);
    const probed = { ...local, lastProbeAt: new Date(t0.getTime() + every) };
    expect(isProbeDue(probed, new Date(t0.getTime() + every + 1000))).toBe(false);
  });
});
