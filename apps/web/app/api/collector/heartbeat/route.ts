import { heartbeatRequestSchema, type HeartbeatResponse } from '@undercut/core';
import { DEFAULT_LEASE_SECONDS, recordHeartbeat } from '@undercut/db';
import { authenticate, parseBody } from '@/lib/collector-api';
import { db } from '@/lib/db';

/** Liveness for the devices page, and lease extension for jobs still in progress. */
export async function POST(request: Request): Promise<Response> {
  const collector = await authenticate(request);
  if (collector instanceof Response) return collector;
  const body = await parseBody(request, heartbeatRequestSchema);
  if (body instanceof Response) return body;

  const extendedLeases = await recordHeartbeat(db(), collector.id, body, DEFAULT_LEASE_SECONDS);
  return Response.json({
    collectorId: collector.id,
    name: collector.name,
    kind: collector.kind,
    extendedLeases,
    serverTime: new Date().toISOString(),
  } satisfies HeartbeatResponse);
}
