import { jobResultSchema, type JobResultResponse } from '@undercut/core';
import { JobNotFoundError, LeaseLostError, submitResult } from '@undercut/db';
import { apiError, authenticate, parseBody } from '@/lib/collector-api';
import { db } from '@/lib/db';
import { observationHooks } from '@/lib/hooks';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const collector = await authenticate(request);
  if (collector instanceof Response) return collector;
  const result = await parseBody(request, jobResultSchema);
  if (result instanceof Response) return result;
  const { id } = await params;

  try {
    const outcome = await submitResult(db(), collector, id, result, {
      hooks: observationHooks,
      onHookError: (hook, err) => console.error(`observation hook ${hook} failed`, err),
    });
    return Response.json({ accepted: true, observationId: outcome.observationId } satisfies JobResultResponse);
  } catch (err) {
    if (err instanceof JobNotFoundError) return apiError(404, err.code, err.message);
    // The collector's lease was superseded; it should drop this result and move on.
    if (err instanceof LeaseLostError) return apiError(409, err.code, err.message);
    throw err;
  }
}
