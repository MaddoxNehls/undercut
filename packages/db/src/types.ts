import type {
  CollectorKind,
  ExtractionRule,
  JobStatus,
  ObservationStatus,
  PriceKind,
  PricePeriod,
  RouteOverride,
} from '@undercut/core';

export interface Watch {
  id: string;
  name: string;
  url: string;
  domain: string;
  extraction: ExtractionRule;
  currency: string | null;
  locale: string | null;
  intervalMinutes: number;
  routeOverride: RouteOverride;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WatchVariant {
  id: string;
  watchId: string;
  label: string;
  url: string | null;
  params: Record<string, unknown>;
  createdAt: Date;
}

export interface Domain {
  domain: string;
  route: CollectorKind;
  routeReason: string | null;
  routeChangedAt: Date;
  lastProbeAt: Date | null;
  maxConcurrency: number;
  minIntervalMs: number;
  respectRobots: boolean;
  lastDispatchedAt: Date | null;
}

export interface Collector {
  id: string;
  kind: CollectorKind;
  name: string;
  tokenHint: string;
  version: string | null;
  hostname: string | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface Job {
  id: string;
  variantId: string;
  domain: string;
  url: string;
  route: CollectorKind;
  isProbe: boolean;
  idempotencyKey: string;
  scheduledFor: Date;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  notBefore: Date;
  leaseId: string | null;
  leasedBy: string | null;
  leaseExpiresAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface Observation {
  id: string;
  jobId: string;
  variantId: string;
  domain: string;
  collectorId: string | null;
  collectorKind: CollectorKind;
  isProbe: boolean;
  status: ObservationStatus;
  price: number | null;
  currency: string | null;
  priceKind: PriceKind | null;
  priceMax: number | null;
  period: PricePeriod | null;
  reason: string | null;
  rawSnippet: string | null;
  httpStatus: number | null;
  finalUrl: string | null;
  durationMs: number | null;
  asOf: Date;
  recordedAt: Date;
}

/** postgres.js returns `numeric` as a string to avoid silent precision loss; prices fit a double. */
export function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
