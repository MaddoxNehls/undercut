/** The routing/politeness key for a URL: its hostname without a leading "www.". */
export function domainOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
}

/** Accepts only absolute http(s) URLs, the only thing a collector can fetch. */
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
