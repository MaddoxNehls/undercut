import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { JobResult } from '@undercut/core';
import { healingPayload } from '@undercut/extraction';
import { LLM, ReplayBackend } from '@undercut/llm';
import { describe, expect, it } from 'vitest';
import { createWatch, decideProposal, enqueueNow, getWatch, healTick, leaseJob, listSelectorHistory, submitResult, type Db } from '../src/index';
import { makeCollector, okResult, useTestDb } from './helpers';

const testDb = useTestDb();
const fixtures = new URL('../../extraction/test/fixtures/', import.meta.url);
const html = (name: string) => readFileSync(new URL(name, fixtures), 'utf8');
const replayLlm = () => new LLM(new ReplayBackend(fileURLToPath(new URL('replay/shop-v2-heal.json', fixtures))));

/** A watch on the v1 shop page with one good observation, whose page then ships the v2 redesign. */
async function brokenWatch(db: Db, lastPrice: number) {
  const watch = await createWatch(db, {
    name: 'Trailhead 40L Pack',
    url: 'http://127.0.0.1:5450/pack',
    extraction: { kind: 'selector', selector: 'span.price-now' },
    intervalMinutes: 60,
    routeOverride: 'cloud',
  });
  await db`UPDATE domains SET min_interval_ms = 0 WHERE domain = ${watch.domain}`;
  const collector = await makeCollector(db, 'cloud');
  const run = async (result: (leaseId: string) => JobResult) => {
    await enqueueNow(db, watch.id, new Date(Date.now() + Math.random() * 1e9));
    const job = await leaseJob(db, collector);
    await submitResult(db, collector, job!.jobId, result(job!.leaseId));
  };
  await run((leaseId) => okResult(leaseId, lastPrice));
  const healing = await healingPayload(html('shop-v2.html'), {});
  for (let i = 0; i < 3; i++) {
    await run((leaseId) => ({
      status: 'parse_error',
      reason: 'selector_not_found',
      snippet: '',
      healing,
      leaseId,
      asOf: new Date(Date.now() + (i + 1) * 1000).toISOString(),
      httpStatus: 200,
      finalUrl: 'http://127.0.0.1:5450/pack',
      durationMs: 800,
    }));
  }
  return watch;
}

describe('self-healing', () => {
  it('re-derives the selector after 3 parse errors and applies it when the value matches', async () => {
    const db = testDb.db();
    const watch = await brokenWatch(db, 129.99);
    const llm = replayLlm();

    const [outcome] = await healTick(db, { llm });
    expect(outcome).toMatchObject({ watchId: watch.id, action: 'apply', usedLlm: true, newRule: { kind: 'selector', selector: '[data-testid="buybox-amount"]' } });
    expect((await getWatch(db, watch.id))?.watch.extraction).toEqual({ kind: 'selector', selector: '[data-testid="buybox-amount"]' });

    const [healed, created] = await listSelectorHistory(db, watch.id);
    expect(healed).toMatchObject({ trigger: 'healed', source: 'llm', status: 'applied', oldValue: 129.99, newValue: 129.99, oldRule: { selector: 'span.price-now' } });
    expect(created).toMatchObject({ trigger: 'created', source: 'user' });

    // The streak is handled once; the confirming job is already queued.
    expect(await healTick(db, { llm })).toEqual([]);
    const [queued] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM jobs WHERE status = 'queued'`;
    expect(queued?.n).toBe(1);
  });

  it('flags the watch for review when the new value drifts too far, and applies it once accepted', async () => {
    const db = testDb.db();
    const watch = await brokenWatch(db, 99.0);

    const [outcome] = await healTick(db, { llm: replayLlm() });
    expect(outcome?.action).toBe('review');
    const flagged = await getWatch(db, watch.id);
    expect(flagged?.watch.reviewReason).toContain('differs from the last known 99');
    expect(flagged?.watch.extraction).toEqual({ kind: 'selector', selector: 'span.price-now' });

    const [proposal] = await listSelectorHistory(db, watch.id);
    expect(proposal).toMatchObject({ status: 'proposed', newValue: 129.99 });
    expect(await decideProposal(db, proposal!.id, true)).toBe(true);
    const accepted = await getWatch(db, watch.id);
    expect(accepted?.watch).toMatchObject({ reviewReason: null, extraction: { selector: '[data-testid="buybox-amount"]' } });
  });

  it('without an LLM, ambiguous heuristics are flagged rather than guessed', async () => {
    const db = testDb.db();
    const watch = await brokenWatch(db, 129.99);
    const [outcome] = await healTick(db, { llm: null });
    expect(outcome).toMatchObject({ action: 'review', usedLlm: false, newRule: null });
    expect((await getWatch(db, watch.id))?.watch.reviewReason).toContain('no candidate');
  });
});
