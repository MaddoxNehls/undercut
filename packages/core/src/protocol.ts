import { z } from 'zod';

/**
 * The collector wire protocol, shared by the server (validation) and both collectors (typing).
 * Cloud workers and local collectors speak exactly the same API; only routing differs.
 */

export const PROTOCOL_VERSION = 1;
export const MAX_LEASE_WAIT_MS = 30_000;

const extractionRule = z.object({
  kind: z.literal('selector'),
  selector: z.string().min(1),
  attribute: z.string().min(1).optional(),
});

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
  z.object({ status: z.literal('parse_error'), reason: z.string().max(200), snippet: z.string().max(2000), ...captureMeta }),
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
