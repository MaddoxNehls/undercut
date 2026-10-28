import type { ExtractionRule, HealingPayload, PriceCandidate, PriceMeaning } from '@undercut/core';
import { ambiguity, decideHeal, DEFAULT_HEAL_POLICY, llmCandidates, rankCandidates, type HealPolicy } from '@undercut/extraction';
import type { LLM } from '@undercut/llm';
import { inTransaction, toJson, type Db } from './client';
import { enqueueNow } from './jobs';
import { recordSelectorChange } from './selectors';

export interface HealOutcome {
  watchId: string;
  action: 'apply' | 'review';
  reason: string;
  newRule: ExtractionRule | null;
  usedLlm: boolean;
}

type BrokenWatch = {
  id: string;
  url: string;
  domain: string;
  extraction: ExtractionRule;
  meaning: PriceMeaning;
  currency: string | null;
  locale: string | null;
  healing: HealingPayload;
  latestId: string;
};

/**
 * Self-healing pass, run by the scheduler. A watch is broken when its last `errorThreshold`
 * observations are all parse errors. Its newest one carries the collector's page digest and
 * heuristic candidates; the LLM is consulted only if those are ambiguous. The decision rule
 * (same meaning, value within `maxDrift` of the last known price) lives in `decideHeal`.
 * Each streak is handled once: any selector change newer than the streak's start skips it.
 */
export async function healTick(db: Db, options: { llm?: LLM | null; policy?: HealPolicy } = {}): Promise<HealOutcome[]> {
  const policy = options.policy ?? DEFAULT_HEAL_POLICY;
  const broken = await db<BrokenWatch[]>`
    SELECT w.id, w.url, w.domain, w.extraction, w.meaning, w.currency, w.locale, recent.healing, recent.latest_id
    FROM watches w
    CROSS JOIN LATERAL (
      SELECT array_agg(o.status) AS statuses,
             (array_agg(o.healing ORDER BY o.as_of DESC))[1] AS healing,
             (array_agg(o.id ORDER BY o.as_of DESC))[1] AS latest_id,
             min(o.recorded_at) AS since
      FROM (
        SELECT o.* FROM observations o JOIN watch_variants v ON v.id = o.variant_id
        WHERE v.watch_id = w.id AND NOT o.is_probe
        ORDER BY o.as_of DESC LIMIT ${policy.errorThreshold}
      ) o
    ) recent
    WHERE w.active AND w.review_reason IS NULL
      AND cardinality(recent.statuses) = ${policy.errorThreshold}
      AND recent.statuses <@ ARRAY['parse_error']::text[]
      AND recent.healing IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM selector_history h WHERE h.watch_id = w.id AND h.created_at >= recent.since)`;

  const outcomes: HealOutcome[] = [];
  for (const watch of broken) outcomes.push(await healWatch(db, watch, policy, options.llm ?? null));
  return outcomes;
}

async function healWatch(db: Db, watch: BrokenWatch, policy: HealPolicy, llm: LLM | null): Promise<HealOutcome> {
  const parse = { ...(watch.currency ? { currency: watch.currency } : {}), ...(watch.locale ? { locale: watch.locale } : {}) };
  let candidates: PriceCandidate[] = watch.healing.candidates;
  let usedLlm = false;
  if (ambiguity(candidates) && llm) {
    const proposed = await llmCandidates(llm, { tag: `heal/${watch.domain}`, url: watch.url, digest: watch.healing.digest, parse });
    candidates = rankCandidates([...candidates, ...proposed]);
    usedLlm = true;
  }

  const [last] = await db<{ price: string }[]>`
    SELECT o.price FROM observations o JOIN watch_variants v ON v.id = o.variant_id
    WHERE v.watch_id = ${watch.id} AND o.status = 'ok' ORDER BY o.as_of DESC LIMIT 1`;
  const lastKnownPrice = last ? Number(last.price) : null;
  const decision = decideHeal({ lastKnownPrice, meaning: watch.meaning, candidates }, policy);
  const candidate = decision.candidate;

  await inTransaction(db, async (tx) => {
    if (candidate) {
      await recordSelectorChange(tx, {
        watchId: watch.id,
        oldRule: watch.extraction,
        newRule: candidate.rule,
        oldValue: lastKnownPrice,
        newValue: candidate.price?.amount ?? null,
        meaning: candidate.meaning,
        trigger: 'healed',
        source: candidate.source,
        status: decision.action === 'apply' ? 'applied' : 'proposed',
        reason: decision.reason,
        observationId: watch.latestId,
      });
    }
    if (decision.action === 'apply') {
      await tx`UPDATE watches SET extraction = ${tx.json(toJson(decision.candidate.rule))}, updated_at = now() WHERE id = ${watch.id}`;
    } else {
      await tx`UPDATE watches SET review_reason = ${decision.reason}, updated_at = now() WHERE id = ${watch.id}`;
    }
  });
  // Confirm the healed selector right away instead of waiting for the next slot.
  if (decision.action === 'apply') await enqueueNow(db, watch.id);
  return { watchId: watch.id, action: decision.action, reason: decision.reason, newRule: candidate?.rule ?? null, usedLlm };
}
