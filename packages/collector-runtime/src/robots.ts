import robotsParser from 'robots-parser';

export const ROBOTS_USER_AGENT = 'UndercutBot';

type Rules = { isAllowed: (url: string) => boolean };

const ALLOW_ALL: Rules = { isAllowed: () => true };

/** robots.txt could not be read (network failure or 5xx): permission is unknown, so try again later. */
export class RobotsUnavailableError extends Error {}

/**
 * robots.txt check with a per-origin cache. A 4xx means there is no robots.txt, so everything
 * is allowed. A 5xx or network failure means permission is unknown: we throw instead of
 * guessing, the job is retried with backoff, and nothing is fetched in the meantime.
 */
export class RobotsCache {
  private readonly cache = new Map<string, { rules: Rules; expiresAt: number }>();

  constructor(
    private readonly userAgent = ROBOTS_USER_AGENT,
    private readonly ttlMs = 60 * 60 * 1000,
    private readonly timeoutMs = 15_000,
  ) {}

  async isAllowed(url: string): Promise<boolean> {
    const origin = new URL(url).origin;
    const cached = this.cache.get(origin);
    if (cached && cached.expiresAt > Date.now()) return cached.rules.isAllowed(url);

    const rules = await this.fetchRules(origin);
    this.cache.set(origin, { rules, expiresAt: Date.now() + this.ttlMs });
    return rules.isAllowed(url);
  }

  private async fetchRules(origin: string): Promise<Rules> {
    const robotsUrl = `${origin}/robots.txt`;
    let response: Response;
    try {
      response = await fetch(robotsUrl, { signal: AbortSignal.timeout(this.timeoutMs), headers: { 'user-agent': this.userAgent } });
    } catch (err) {
      throw new RobotsUnavailableError(`robots.txt unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (response.status >= 400 && response.status < 500) return ALLOW_ALL;
    if (!response.ok) throw new RobotsUnavailableError(`robots.txt returned HTTP ${response.status}`);
    const robots = robotsParser(robotsUrl, await response.text());
    return { isAllowed: (url) => robots.isAllowed(url, this.userAgent) ?? true };
  }
}
