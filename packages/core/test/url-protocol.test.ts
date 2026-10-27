import { describe, expect, it } from 'vitest';
import { domainOf, isHttpUrl, jobResultSchema } from '../src/index';

describe('url helpers', () => {
  it('normalizes domains', () => {
    expect(domainOf('https://www.Expedia.com/Hotel?x=1')).toBe('expedia.com');
    expect(domainOf('http://books.toscrape.com/catalogue/x.html')).toBe('books.toscrape.com');
  });

  it('accepts only http(s)', () => {
    expect(isHttpUrl('https://a.test')).toBe(true);
    expect(isHttpUrl('ftp://a.test')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });
});

describe('protocol', () => {
  const meta = {
    leaseId: '6f1c1f9e-1b7a-4a39-9f43-1c2b9d1e2f30',
    asOf: new Date().toISOString(),
    httpStatus: 200,
    finalUrl: 'https://a.test',
    durationMs: 10,
    snippet: '',
  };

  it('rejects an ok result without a price', () => {
    expect(jobResultSchema.safeParse({ status: 'ok', ...meta }).success).toBe(false);
  });

  it('accepts a blocked result with a reason', () => {
    expect(jobResultSchema.safeParse({ status: 'blocked', reason: 'http_403', ...meta }).success).toBe(true);
  });
});
