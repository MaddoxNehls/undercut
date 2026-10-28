import { classifyCapture, type JobResult, type LeasedJob } from '@undercut/core';
import { extractPrice } from '@undercut/core/extract';
import { healingPayload } from '@undercut/extraction';
import type { BrowserContext } from 'playwright';

export interface CaptureOptions {
  navigationTimeoutMs?: number;
  /** How long to wait for a client-rendered price to appear before judging the page. */
  selectorTimeoutMs?: number;
}

const SNIPPET_MAX = 2000;

/**
 * Loads the job's page in a real browser, extracts the price, and classifies the outcome.
 * Never throws: navigation failures become retryable `error` results.
 */
export async function capture(context: BrowserContext, job: LeasedJob, options: CaptureOptions = {}): Promise<JobResult> {
  const started = Date.now();
  const page = await context.newPage();
  try {
    const response = await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: options.navigationTimeoutMs ?? 45_000 });
    const httpStatus = response?.status() ?? null;
    if ((httpStatus === null || httpStatus < 400) && job.extraction.kind === 'selector') {
      // A miss is fine here; the classifier decides whether a missing price means "blocked".
      await page
        .waitForSelector(job.extraction.selector, { state: 'attached', timeout: options.selectorTimeoutMs ?? 10_000 })
        .catch(() => undefined);
    }

    const html = await page.content();
    const finalUrl = page.url();
    const extraction = await extractPrice({ requestedUrl: job.url, finalUrl, httpStatus, html }, job.extraction, job.parse);
    const verdict = classifyCapture({ httpStatus, html, extraction });
    const meta = { leaseId: job.leaseId, asOf: new Date().toISOString(), httpStatus, finalUrl, durationMs: Date.now() - started };

    switch (verdict.status) {
      case 'ok':
        return { status: 'ok', price: verdict.price, snippet: verdict.snippet.slice(0, SNIPPET_MAX), ...meta };
      case 'blocked':
        return { status: 'blocked', reason: verdict.reason, snippet: verdict.snippet.slice(0, SNIPPET_MAX), ...meta };
      case 'parse_error': {
        // The page loaded but the rule failed: ship what the server needs to heal the selector.
        const healing = await healingPayload(html, job.parse).catch(() => undefined);
        return { status: 'parse_error', reason: verdict.reason, snippet: verdict.snippet.slice(0, SNIPPET_MAX), ...(healing ? { healing } : {}), ...meta };
      }
      case 'transient':
        return { status: 'error', leaseId: job.leaseId, error: verdict.reason };
    }
  } catch (err) {
    return { status: 'error', leaseId: job.leaseId, error: (err instanceof Error ? err.message : String(err)).slice(0, 1000) };
  } finally {
    await page.close().catch(() => undefined);
  }
}
