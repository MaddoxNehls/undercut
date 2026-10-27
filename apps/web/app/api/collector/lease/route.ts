import { leaseRequestSchema, type LeaseResponse } from '@undercut/core';
import { waitForLease } from '@undercut/db';
import { authenticate, parseBody } from '@/lib/collector-api';
import { db } from '@/lib/db';

export const maxDuration = 60;

/**
 * Long-poll for work. Holds the request open up to `waitMs` until a job routed to this
 * collector's kind is leasable. A job leased to a client that hung up is recovered by lease expiry.
 */
export async function POST(request: Request): Promise<Response> {
  const collector = await authenticate(request);
  if (collector instanceof Response) return collector;
  const body = await parseBody(request, leaseRequestSchema);
  if (body instanceof Response) return body;

  const job = await waitForLease(db(), collector, { waitMs: body.waitMs, signal: request.signal });
  return Response.json({ job } satisfies LeaseResponse);
}
