import type { ParseOptions, PriceCandidate } from '@undercut/core';
import { discover, type DiscoveryResult } from '@undercut/extraction';
import type { LLM } from '@undercut/llm';
import type { BrowserContext, Page } from 'playwright';

export interface AnalyzedCandidate extends PriceCandidate {
  /** PNG data URL of the element in context, outlined, or null if it isn't visible. */
  crop: string | null;
}

export interface Analysis extends Omit<DiscoveryResult, 'candidates'> {
  url: string;
  finalUrl: string;
  httpStatus: number | null;
  title: string;
  candidates: AnalyzedCandidate[];
}

const CROP_PADDING = 48;

/** The slice of a DOM element the highlight touches (this package doesn't load the DOM lib). */
type Outlinable = { style: { outline: string; outlineOffset: string } };

/**
 * The "paste a URL" flow: render the page in a real browser, find price candidates
 * (heuristics first, LLM if ambiguous), and screenshot each candidate's element with a highlight
 * so the user can confirm one by sight rather than by reading selectors.
 */
export async function analyzeUrl(
  context: BrowserContext,
  url: string,
  options: { parse?: ParseOptions; llm?: LLM | null; forceLlm?: boolean; maxCandidates?: number } = {},
): Promise<Analysis> {
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
    const html = await page.content();
    const result = await discover(html, { url, parse: options.parse ?? {}, llm: options.llm ?? null, forceLlm: options.forceLlm ?? false });

    const candidates: AnalyzedCandidate[] = [];
    for (const candidate of result.candidates.slice(0, options.maxCandidates ?? 6)) {
      candidates.push({ ...candidate, crop: await cropFor(page, candidate).catch(() => null) });
    }
    return {
      ...result,
      candidates,
      url,
      finalUrl: page.url(),
      httpStatus: response?.status() ?? null,
      title: (await page.title()).slice(0, 200),
    };
  } finally {
    await page.close();
  }
}

/** Outlines the candidate's element and captures it with some surrounding context. */
async function cropFor(page: Page, candidate: PriceCandidate): Promise<string | null> {
  const locator =
    candidate.rule.kind === 'selector'
      ? page.locator(candidate.rule.selector).first()
      : // JSON-LD has no element; show where that value appears on the page, if it does.
        page.getByText(visibleForm(candidate), { exact: false }).first();
  if (!(await locator.isVisible({ timeout: 1000 }).catch(() => false))) return null;

  await locator.scrollIntoViewIfNeeded({ timeout: 2000 });
  await locator.evaluate((el: Outlinable) => {
    el.style.outline = '3px solid #f5c400';
    el.style.outlineOffset = '3px';
  });
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) return null;
  const x = Math.max(0, box.x - CROP_PADDING * 3);
  const y = Math.max(0, box.y - CROP_PADDING);
  const clip = {
    x,
    y,
    width: Math.min(viewport.width - x, box.width + CROP_PADDING * 6),
    height: Math.min(viewport.height - y, box.height + CROP_PADDING * 2),
  };
  const png = await page.screenshot({ clip });
  await locator.evaluate((el: Outlinable) => {
    el.style.outline = '';
  });
  return `data:image/png;base64,${png.toString('base64')}`;
}

function visibleForm(candidate: PriceCandidate): string {
  const amount = candidate.price?.amount ?? 0;
  return amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
