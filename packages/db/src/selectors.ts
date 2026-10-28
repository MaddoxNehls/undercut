import type { CandidateSource, ExtractionRule, PriceMeaning } from '@undercut/core';
import { inTransaction, toJson, type Db } from './client';
import { toNumberOrNull } from './types';

export type SelectorSource = CandidateSource | 'user';
export type SelectorTrigger = 'created' | 'edited' | 'healed';
export type SelectorStatus = 'applied' | 'proposed' | 'accepted' | 'rejected';

export interface SelectorChange {
  id: string;
  watchId: string;
  oldRule: ExtractionRule | null;
  newRule: ExtractionRule;
  oldValue: number | null;
  newValue: number | null;
  meaning: PriceMeaning;
  trigger: SelectorTrigger;
  source: SelectorSource;
  status: SelectorStatus;
  reason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export async function recordSelectorChange(
  tx: Db,
  change: {
    watchId: string;
    oldRule: ExtractionRule | null;
    newRule: ExtractionRule;
    meaning: PriceMeaning;
    trigger: SelectorTrigger;
    source: SelectorSource;
    status: SelectorStatus;
    oldValue?: number | null;
    newValue?: number | null;
    reason?: string | null;
    observationId?: string | null;
  },
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO selector_history (watch_id, old_rule, new_rule, old_value, new_value, meaning, trigger, source, status, reason, observation_id)
    VALUES (${change.watchId}, ${change.oldRule ? tx.json(toJson(change.oldRule)) : null}, ${tx.json(toJson(change.newRule))},
            ${change.oldValue ?? null}, ${change.newValue ?? null}, ${change.meaning}, ${change.trigger}, ${change.source},
            ${change.status}, ${change.reason ?? null}, ${change.observationId ?? null})
    RETURNING id`;
  if (!row) throw new Error('selector_history insert returned no row');
  return row.id;
}

export async function listSelectorHistory(db: Db, watchId: string): Promise<SelectorChange[]> {
  const rows = await db<(Omit<SelectorChange, 'oldValue' | 'newValue'> & { oldValue: string | null; newValue: string | null })[]>`
    SELECT * FROM selector_history WHERE watch_id = ${watchId} ORDER BY created_at DESC`;
  return rows.map((r) => ({ ...r, oldValue: toNumberOrNull(r.oldValue), newValue: toNumberOrNull(r.newValue) }));
}

/** Resolves a healing proposal: accepting swaps in the new rule; either way the review flag clears. */
export async function decideProposal(db: Db, historyId: string, accept: boolean): Promise<boolean> {
  return inTransaction(db, async (tx) => {
    const [proposal] = await tx<{ watchId: string; newRule: ExtractionRule }[]>`
      SELECT watch_id, new_rule FROM selector_history WHERE id = ${historyId} AND status = 'proposed' FOR UPDATE`;
    if (!proposal) return false;
    await tx`UPDATE selector_history SET status = ${accept ? 'accepted' : 'rejected'}, decided_at = now() WHERE id = ${historyId}`;
    if (accept) {
      await tx`UPDATE watches SET extraction = ${tx.json(toJson(proposal.newRule))}, review_reason = NULL, updated_at = now() WHERE id = ${proposal.watchId}`;
    } else {
      await tx`UPDATE watches SET review_reason = NULL, updated_at = now() WHERE id = ${proposal.watchId}`;
    }
    return true;
  });
}
