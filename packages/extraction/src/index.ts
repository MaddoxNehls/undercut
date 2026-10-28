export { buildDigest, cssPath, PRICE_TEXT, type DigestOptions } from './digest';
export { heuristicCandidates, validateRule, inferMeaning, rankCandidates, ambiguity, candidateFromNode } from './candidates';
export { llmCandidates, llmReplySchema, type LlmReply } from './llm-candidates';
export { discover, type DiscoveryResult } from './discover';
export { decideHeal, DEFAULT_HEAL_POLICY, type HealDecision, type HealPolicy } from './heal';

import type { HealingPayload, ParseOptions } from '@undercut/core';
import { heuristicCandidates } from './candidates';
import { buildDigest } from './digest';

/** What a collector attaches to a parse_error: enough for the server to heal without the page. */
export async function healingPayload(html: string, parse: ParseOptions): Promise<HealingPayload> {
  return { digest: buildDigest(html, { budgetChars: 6000, maxNodes: 40 }), candidates: (await heuristicCandidates(html, parse)).slice(0, 10) };
}
