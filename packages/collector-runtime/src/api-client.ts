import {
  apiErrorSchema,
  heartbeatResponseSchema,
  jobResultResponseSchema,
  leaseResponseSchema,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type JobResult,
  type JobResultResponse,
  type LeasedJob,
} from '@undercut/core';
import type { z } from 'zod';

export class CollectorApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The server surface a collector needs. The runner depends on this, so tests can fake it. */
export interface CollectorServer {
  lease(waitMs: number, signal?: AbortSignal): Promise<LeasedJob | null>;
  submit(jobId: string, result: JobResult): Promise<JobResultResponse>;
  heartbeat(body: HeartbeatRequest): Promise<HeartbeatResponse>;
}

/** HTTP client for the collector API (`/api/collector/*`), authenticated with a device token. */
export class CollectorApi implements CollectorServer {
  private readonly baseUrl: string;

  constructor(
    serverUrl: string,
    private readonly token: string,
  ) {
    this.baseUrl = serverUrl.replace(/\/+$/, '');
  }

  async lease(waitMs: number, signal?: AbortSignal): Promise<LeasedJob | null> {
    // Give the server's long-poll room to answer before our own timeout fires.
    const response = await this.post('/api/collector/lease', { waitMs }, leaseResponseSchema, waitMs + 15_000, signal);
    return response.job;
  }

  submit(jobId: string, result: JobResult): Promise<JobResultResponse> {
    return this.post(`/api/collector/jobs/${encodeURIComponent(jobId)}/result`, result, jobResultResponseSchema, 30_000);
  }

  heartbeat(body: HeartbeatRequest): Promise<HeartbeatResponse> {
    return this.post('/api/collector/heartbeat', body, heartbeatResponseSchema, 15_000);
  }

  private async post<S extends z.ZodType>(path: string, body: unknown, schema: S, timeoutMs: number, signal?: AbortSignal): Promise<z.infer<S>> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(json);
      throw new CollectorApiError(
        response.status,
        parsed.success ? parsed.data.code : 'http_error',
        parsed.success ? parsed.data.error : `HTTP ${response.status} from ${path}`,
      );
    }
    return schema.parse(json);
  }
}
