'use server';

import { isHttpUrl, PRICE_MEANINGS, type PriceMeaning } from '@undercut/core';
import { analyzeUrl, launchHeadlessBrowser } from '@undercut/collector-runtime';
import { createExtractionSession, createWatch, enqueueNow, getExtractionSession } from '@undercut/db';
import { llmFromEnv } from '@undercut/llm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';

export interface AnalyzeState {
  url: string;
  error: string | null;
}

/**
 * Renders the page in headless Chromium on this server, finds price candidates (heuristics
 * first, LLM only if they're ambiguous), and stores them with element screenshots for the picker.
 */
export async function analyzeUrlAction(_prev: AnalyzeState | null, form: FormData): Promise<AnalyzeState> {
  const url = String(form.get('url') ?? '').trim();
  if (!isHttpUrl(url)) return { url, error: 'Enter a full URL starting with http:// or https://.' };

  let sessionId: string;
  const browser = await launchHeadlessBrowser();
  try {
    const analysis = await analyzeUrl(browser.context, url, { llm: llmFromEnv() });
    if (analysis.candidates.length === 0) {
      return { url, error: `No price found on that page (${analysis.reason}). You can enter a selector manually below.` };
    }
    sessionId = await createExtractionSession(db(), analysis);
  } catch (err) {
    return { url, error: `Could not analyze the page: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}` };
  } finally {
    await browser.close();
  }
  redirect(`/watches/new/${sessionId}`);
}

const pickSchema = z.object({
  candidate: z.coerce.number().int().min(0),
  name: z.string().trim().min(1).max(120),
  intervalMinutes: z.coerce.number().int().min(5).max(10080),
  routeOverride: z.enum(['auto', 'cloud', 'local']),
});

/** Creates the watch from the confirmed candidate and records who chose the rule. */
export async function createFromCandidateAction(sessionId: string, form: FormData): Promise<void> {
  const session = await getExtractionSession(db(), sessionId);
  const parsed = pickSchema.safeParse(Object.fromEntries(form));
  if (!session || !parsed.success) redirect(`/watches/new/${sessionId}?error=1`);
  const candidate = session.candidates[parsed.data.candidate];
  if (!candidate) redirect(`/watches/new/${sessionId}?error=1`);

  const meaning: PriceMeaning = PRICE_MEANINGS.includes(candidate.meaning) ? candidate.meaning : 'current';
  const watch = await createWatch(db(), {
    name: parsed.data.name,
    url: session.url,
    extraction: candidate.rule,
    currency: candidate.price?.currency ?? null,
    intervalMinutes: parsed.data.intervalMinutes,
    routeOverride: parsed.data.routeOverride,
    meaning,
    ruleSource: candidate.source,
  });
  await enqueueNow(db(), watch.id);
  revalidatePath('/');
  redirect(`/watches/${watch.id}`);
}
