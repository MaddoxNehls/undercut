import { schedulerTick } from '@undercut/db';
import { apiError } from '@/lib/collector-api';
import { db } from '@/lib/db';

/** Scheduler entry point for a platform cron (Vercel Cron sends GET with `Bearer $CRON_SECRET`). */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return apiError(401, 'unauthenticated', 'invalid cron secret');
  }
  return Response.json(await schedulerTick(db()));
}

export const POST = GET;
