import { dispatchDeliveries, healTick, schedulerTick } from '@undercut/db';
import { channelsFromEnv } from '@undercut/notify';
import { llmFromEnv } from '@undercut/llm';
import { apiError } from '@/lib/collector-api';
import { db } from '@/lib/db';

/** Scheduler entry point for a platform cron (Vercel Cron sends GET with `Bearer $CRON_SECRET`). */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return apiError(401, 'unauthenticated', 'invalid cron secret');
  }
  const tick = await schedulerTick(db());
  const healed = await healTick(db(), { llm: llmFromEnv() });
  const deliveries = await dispatchDeliveries(db(), channelsFromEnv(), { appUrl: new URL(request.url).origin });
  return Response.json({ ...tick, healed, deliveries });
}

export const POST = GET;
