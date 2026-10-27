import type { ExtractionResult } from '../extract/types';
import type { ParsedPrice } from '../types';

/**
 * Fingerprints of bot-defense interstitials. Only challenge-page markers are listed, not the
 * vendors' always-on sensor scripts, which also appear on pages that rendered fine.
 */
export const CHALLENGE_SIGNATURES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'cloudflare', pattern: /<title>\s*(?:just a moment|attention required)|cf-chl-|challenges\.cloudflare\.com\/cdn-cgi\/challenge|cf_chl_opt/i },
  { id: 'akamai', pattern: /<title>\s*access denied\s*<\/title>[\s\S]*reference\s*#/i },
  { id: 'perimeterx', pattern: /px-captcha|press (?:&amp;|&) hold/i },
  { id: 'datadome', pattern: /captcha-delivery\.com/i },
  { id: 'imperva', pattern: /incapsula incident id|request unsuccessful\. incapsula/i },
  { id: 'aws-waf', pattern: /gokuprops|awswafcookiedomainlist/i },
  { id: 'recaptcha', pattern: /class="g-recaptcha|recaptcha\/api\.js/i },
  { id: 'hcaptcha', pattern: /class="h-captcha|hcaptcha\.com\/1\/api\.js/i },
  { id: 'generic-bot-wall', pattern: /are you a (?:robot|human)|unusual traffic from your|verify you are (?:a )?human|access to this page has been denied/i },
];

/** HTTP statuses that mean "you, specifically, are not welcome", not "the site is down". */
const BLOCK_STATUSES = new Set([401, 403, 407, 429]);

/** A page with less visible text than this is an app shell or an interstitial, not a product page. */
const SHELL_TEXT_THRESHOLD = 200;

export type CaptureVerdict =
  | { status: 'ok'; price: ParsedPrice; snippet: string }
  | { status: 'blocked'; reason: string; snippet: string }
  | { status: 'parse_error'; reason: string; snippet: string }
  /** Transient (5xx without a challenge, etc.): retry the job, record nothing. */
  | { status: 'transient'; reason: string };

export interface CaptureEvidence {
  httpStatus: number | null;
  html: string;
  extraction: ExtractionResult;
}

/**
 * Decides what a capture means. Order matters:
 *  1. A parsed price on a 2xx page wins, even if a captcha widget is embedded somewhere.
 *  2. Explicit refusals (403/429...) and challenge-page fingerprints are blocks.
 *  3. Empty price elements and near-empty shells are blocks: defenses often serve a 200
 *     page that simply never renders the price.
 *  4. Anything else is a parse error, which points at the selector (M3 self-heals these).
 */
export function classifyCapture({ httpStatus, html, extraction }: CaptureEvidence): CaptureVerdict {
  const ok2xx = httpStatus === null || (httpStatus >= 200 && httpStatus < 300);
  if (extraction.status === 'ok' && ok2xx) {
    return { status: 'ok', price: extraction.price, snippet: extraction.snippet };
  }

  const text = visibleText(html);
  const textSnippet = text.slice(0, 300);
  if (httpStatus !== null && BLOCK_STATUSES.has(httpStatus)) {
    return { status: 'blocked', reason: `http_${httpStatus}`, snippet: textSnippet };
  }
  const signature = CHALLENGE_SIGNATURES.find((s) => s.pattern.test(html));
  if (signature) return { status: 'blocked', reason: `challenge:${signature.id}`, snippet: textSnippet };

  if (httpStatus !== null && httpStatus >= 500) return { status: 'transient', reason: `http_${httpStatus}` };
  if (httpStatus !== null && !ok2xx) return { status: 'parse_error', reason: `http_${httpStatus}`, snippet: textSnippet };

  switch (extraction.status) {
    case 'empty':
      return { status: 'blocked', reason: 'empty_price', snippet: extraction.snippet };
    case 'not_found':
      return text.length < SHELL_TEXT_THRESHOLD
        ? { status: 'blocked', reason: 'empty_page', snippet: textSnippet }
        : { status: 'parse_error', reason: 'selector_not_found', snippet: textSnippet };
    case 'unparseable':
      return { status: 'parse_error', reason: `unparseable:${extraction.text.slice(0, 60)}`, snippet: extraction.snippet };
    case 'ok':
      return { status: 'parse_error', reason: 'unexpected_status', snippet: extraction.snippet };
  }
}

/** Rough visible text: strips script/style/noscript blocks, then tags. */
export function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
