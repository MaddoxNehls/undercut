import { priceMeaningSchema, type DigestNode, type ParseOptions, type PriceCandidate } from '@undercut/core';
import type { LLM } from '@undercut/llm';
import { z } from 'zod';
import { candidateFromNode } from './candidates';

export const llmReplySchema = z.object({
  candidates: z
    .array(
      z.object({
        nodeId: z.string().describe('id of a digest node, e.g. "n3"'),
        meaning: priceMeaningSchema.describe('current = what you would pay now; was = struck/old price; per_unit = per night/person/month; total = sum for the whole stay/order'),
        confidence: z.number().min(0).max(1),
        rationale: z.string().max(300),
      }),
    )
    .max(5),
});
export type LlmReply = z.infer<typeof llmReplySchema>;

const SYSTEM = `You locate prices on product and booking pages for a price tracker.
You get a digest of the page: only elements whose text looks like a price, each with an id, a CSS path,
its text, semantic hints from the element and its ancestors, a nearby label, and whether it is struck through.
Pick up to 5 nodes that could be the price a shopper would track, most likely first, and say what each means.
Prefer the main product's current price over related items, struck-through "was" prices, taxes, and fees.
Only use node ids that appear in the digest.`;

/**
 * Asks the LLM to choose among digest nodes. Choosing by node id, rather than writing selectors,
 * means every answer maps to a CSS path we computed ourselves and can validate.
 */
export async function llmCandidates(
  llm: LLM,
  input: { tag: string; url: string; digest: readonly DigestNode[]; parse: ParseOptions },
): Promise<PriceCandidate[]> {
  if (input.digest.length === 0) return [];
  const reply = await llm.structured(
    input.tag,
    SYSTEM,
    [{ role: 'user', content: `Page: ${input.url}\n\nDigest:\n${JSON.stringify(input.digest)}` }],
    llmReplySchema,
    { schemaName: 'price_candidates', maxTokens: 1500 },
  );
  const byId = new Map(input.digest.map((n) => [n.id, n]));
  return reply.candidates.flatMap((c) => {
    const node = byId.get(c.nodeId);
    return node ? [candidateFromNode(node, c.meaning, 'llm', c.confidence, input.parse, c.rationale)] : [];
  });
}
