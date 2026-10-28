import { z } from 'zod';

/**
 * The collector wire protocol, shared by the server (validation) and both collectors (typing).
 * Cloud workers and local collectors speak exactly the same API; only routing differs.
 */

export const PROTOCOL_VERSION = 1;
export const MAX_LEASE_WAIT_MS = 30_000;

export const extractionRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('selector'), selector: z.string().min(1).max(500), attribute: z.string().min(1).max(60).optional() }),
  z.object({ kind: z.literal('json-ld'), field: z.enum(['price', 'lowPrice']) }),
]);
const extractionRule = extractionRuleSchema;

export const leaseRequestSchema = z.object({
  /** How long the server may hold the request open waiting for work (long-poll). */
  waitMs: z.number().int().min(0).max(MAX_LEASE_WAIT_MS).default(0),
});
export type LeaseRequest = z.input<typeof leaseRequestSchema>;

export const leasedJobSchema = z.object({
  jobId: z.uuid(),
  /** Fencing token: results are accepted only with the lease that is current on the server. */
  leaseId: z.uuid(),
  leaseExpiresAt: z.iso.datetime(),
  url: z.url(),
  domain: z.string(),
  isProbe: z.boolean(),
  extraction: extractionRule,
  parse: z.object({ locale: z.string().optional(), currency: z.string().optional() }),
  respectRobots: z.boolean(),
});
export type LeasedJob = z.infer<typeof leasedJobSchema>;

export const leaseResponseSchema = z.object({ job: leasedJobSchema.nullable() });
export type LeaseResponse = z.infer<typeof leaseResponseSchema>;

const priceSchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().nullable(),
  kind: z.enum(['exact', 'from', 'range']),
  max: z.number().optional(),
  period: z.enum(['night', 'day', 'week', 'month', 'year', 'person']).optional(),
});

export const priceMeaningSchema = z.enum(['current', 'was', 'per_unit', 'total']);

/** One price-looking element of a page, as shown to the LLM: compact and addressable. */
export const digestNodeSchema = z.object({
  id: z.string().max(12),
  css: z.string().max(300),
  text: z.string().max(120),
  /** Semantic hints from the element and its ancestors: classes, ids, itemprop, tag names. */
  hints: z.array(z.string().max(40)).max(12),
  /** Nearby label text such as "per night", "total", "was". */
  label: z.string().max(80).optional(),
  /** Rendered struck-through (<del>, <s>, line-through): almost always a "was" price. */
  struck: z.boolean(),
});
export type DigestNode = z.infer<typeof digestNodeSchema>;

export const candidateSourceSchema = z.enum(['json-ld', 'microdata', 'opengraph', 'class-pattern', 'llm']);
export type CandidateSource = z.infer<typeof candidateSourceSchema>;

/** A proposed extraction rule, already validated against the captured DOM (`price` is what it read). */
export const priceCandidateSchema = z.object({
  rule: extractionRuleSchema,
  source: candidateSourceSchema,
  meaning: priceMeaningSchema,
  confidence: z.number().min(0).max(1),
  price: priceSchema.nullable(),
  text: z.string().max(200).optional(),
  rationale: z.string().max(300).optional(),
});
export type PriceCandidate = z.infer<typeof priceCandidateSchema>;

/** Attached to a parse_error so the server can heal the selector without re-fetching the page. */
export const healingPayloadSchema = z.object({
  digest: z.array(digestNodeSchema).max(80),
  candidates: z.array(priceCandidateSchema).max(20),
});
export type HealingPayload = z.infer<typeof healingPayloadSchema>;

const captureMeta = {
  leaseId: z.uuid(),
  asOf: z.iso.datetime(),
  httpStatus: z.number().int().nullable(),
  finalUrl: z.string(),
  durationMs: z.number().int().nonnegative(),
};

/** What a collector reports for a leased job. */
export const jobResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), price: priceSchema, snippet: z.string().max(2000), ...captureMeta }),
  z.object({ status: z.literal('blocked'), reason: z.string().max(200), snippet: z.string().max(2000), ...captureMeta }),
  z.object({
    status: z.literal('parse_error'),
    reason: z.string().max(200),
    snippet: z.string().max(2000),
    healing: healingPayloadSchema.optional(),
    ...captureMeta,
  }),
  /** The attempt failed for reasons unrelated to the site's verdict (timeout, DNS, 5xx): retry. */
  z.object({ status: z.literal('error'), leaseId: z.uuid(), error: z.string().max(1000) }),
  /** robots.txt disallows the URL: don't retry, don't record a price. */
  z.object({ status: z.literal('skipped'), leaseId: z.uuid(), reason: z.string().max(200) }),
]);
export type JobResult = z.infer<typeof jobResultSchema>;

export const jobResultResponseSchema = z.object({
  accepted: z.boolean(),
  observationId: z.string().nullable(),
});
export type JobResultResponse = z.infer<typeof jobResultResponseSchema>;

export const heartbeatRequestSchema = z.object({
  version: z.string().max(40),
  hostname: z.string().max(200).optional(),
  /** Leases the collector is still working on; the server extends them. */
  activeLeaseIds: z.array(z.uuid()).max(64).default([]),
});
export type HeartbeatRequest = z.input<typeof heartbeatRequestSchema>;

export const heartbeatResponseSchema = z.object({
  collectorId: z.uuid(),
  name: z.string(),
  kind: z.enum(['cloud', 'local']),
  extendedLeases: z.number().int(),
  serverTime: z.iso.datetime(),
});
export type HeartbeatResponse = z.infer<typeof heartbeatResponseSchema>;

export const apiErrorSchema = z.object({ error: z.string(), code: z.string() });
export type ApiError = z.infer<typeof apiErrorSchema>;
