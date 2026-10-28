import type { DigestNode, ParseOptions, PriceCandidate } from '@undercut/core';
import type { LLM } from '@undercut/llm';
import { ambiguity, heuristicCandidates, rankCandidates, validateRule } from './candidates';
import { buildDigest } from './digest';
import { llmCandidates } from './llm-candidates';

export interface DiscoveryResult {
  candidates: PriceCandidate[];
  digest: DigestNode[];
  usedLlm: boolean;
  /** Why the LLM was or wasn't consulted. */
  reason: string;
}

/**
 * Finds the price on a captured page. Heuristics run first because they are free and
 * deterministic; the LLM is consulted only when they are ambiguous (or when forced, for demos).
 * LLM picks are re-validated against the full HTML with the same extractor collectors use.
 */
export async function discover(
  html: string,
  options: { url: string; parse?: ParseOptions; llm?: LLM | null; forceLlm?: boolean },
): Promise<DiscoveryResult> {
  const parse = options.parse ?? {};
  const digest = buildDigest(html);
  const heuristics = await heuristicCandidates(html, parse);
  const why = ambiguity(heuristics);

  if (!why && !options.forceLlm) return { candidates: rankCandidates(heuristics), digest, usedLlm: false, reason: 'heuristics agree on one price' };
  if (!options.llm) return { candidates: rankCandidates(heuristics), digest, usedLlm: false, reason: `${why ?? 'forced'}; no LLM configured` };

  const proposed = await llmCandidates(options.llm, { tag: `discover/${new URL(options.url).hostname}`, url: options.url, digest, parse });
  const validated = await Promise.all(proposed.map(async (c) => ({ ...c, ...(await validateRule(html, c.rule, parse)) })));
  const merged = dedupe([...heuristics, ...validated]);
  return { candidates: rankCandidates(merged), digest, usedLlm: true, reason: why ?? 'LLM forced' };
}

/** One candidate per rule; when two sources agree, keep the more trusted one. */
function dedupe(candidates: readonly PriceCandidate[]): PriceCandidate[] {
  const byRule = new Map<string, PriceCandidate>();
  for (const c of rankCandidates(candidates)) {
    const key = JSON.stringify(c.rule);
    if (!byRule.has(key)) byRule.set(key, c);
  }
  return [...byRule.values()];
}
