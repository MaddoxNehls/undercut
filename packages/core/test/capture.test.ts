import { describe, expect, it } from 'vitest';
import { classifyCapture, type ExtractionResult } from '../src/index';
import { SelectorExtractor } from '../src/extract/index';

const okExtraction: ExtractionResult = {
  status: 'ok',
  price: { amount: 10, currency: 'USD', kind: 'exact' },
  text: '$10',
  snippet: '<span>$10</span>',
};
const longText = `<p>${'Real product description. '.repeat(20)}</p>`;

describe('classifyCapture', () => {
  it('accepts a parsed price on a 200 page, even with an embedded captcha widget', () => {
    const html = `<html><body>${longText}<div class="g-recaptcha"></div></body></html>`;
    expect(classifyCapture({ httpStatus: 200, html, extraction: okExtraction }).status).toBe('ok');
  });

  it.each([403, 429, 401])('treats HTTP %d as blocked', (status) => {
    const verdict = classifyCapture({ httpStatus: status, html: '<html></html>', extraction: { status: 'not_found' } });
    expect(verdict).toMatchObject({ status: 'blocked', reason: `http_${status}` });
  });

  it.each([
    ['cloudflare', '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>'],
    ['datadome', '<html><body><iframe src="https://geo.captcha-delivery.com/captcha/"></iframe></body></html>'],
    ['perimeterx', '<html><body><div id="px-captcha"></div>Press &amp; Hold to confirm you are a human</body></html>'],
    ['generic-bot-wall', `<html><body>${longText}<p>We detected unusual traffic from your computer network.</p></body></html>`],
  ])('detects a %s challenge page served with 200', (vendor, html) => {
    const verdict = classifyCapture({ httpStatus: 200, html, extraction: { status: 'not_found' } });
    expect(verdict).toMatchObject({ status: 'blocked', reason: `challenge:${vendor}` });
  });

  it('treats an empty price element as blocked', () => {
    const verdict = classifyCapture({ httpStatus: 200, html: longText, extraction: { status: 'empty', snippet: '<span class="price"></span>' } });
    expect(verdict).toMatchObject({ status: 'blocked', reason: 'empty_price' });
  });

  it('treats a near-empty app shell as blocked', () => {
    const html = '<html><body><div id="root"></div><script>window.__APP__={}</script></body></html>';
    expect(classifyCapture({ httpStatus: 200, html, extraction: { status: 'not_found' } })).toMatchObject({
      status: 'blocked',
      reason: 'empty_page',
    });
  });

  it('blames the selector when a full page has no match', () => {
    expect(classifyCapture({ httpStatus: 200, html: longText, extraction: { status: 'not_found' } })).toMatchObject({
      status: 'parse_error',
      reason: 'selector_not_found',
    });
  });

  it('reports unparseable text as a parse error', () => {
    const verdict = classifyCapture({
      httpStatus: 200,
      html: longText,
      extraction: { status: 'unparseable', text: 'Call for price', snippet: '' },
    });
    expect(verdict).toMatchObject({ status: 'parse_error', reason: 'unparseable:Call for price' });
  });

  it('treats a plain 5xx as transient', () => {
    expect(classifyCapture({ httpStatus: 502, html: 'Bad gateway', extraction: { status: 'not_found' } })).toMatchObject({
      status: 'transient',
    });
  });
});

describe('SelectorExtractor', () => {
  const extractor = new SelectorExtractor();
  const page = (html: string) => ({ requestedUrl: 'https://x.test', finalUrl: 'https://x.test', httpStatus: 200, html });

  it('reads and parses the first matching element', async () => {
    const html = '<p class="price_color">£51.77</p><p class="price_color">£1.00</p>';
    const result = await extractor.extract(page(html), { kind: 'selector', selector: '.price_color' }, {});
    expect(result).toMatchObject({ status: 'ok', price: { amount: 51.77, currency: 'GBP' } });
  });

  it('reads an attribute when asked', async () => {
    const html = '<meta itemprop="price" content="1299.00"><meta itemprop="priceCurrency" content="USD">';
    const rule = { kind: 'selector' as const, selector: '[itemprop=price]', attribute: 'content' };
    const result = await extractor.extract(page(html), rule, { currency: 'USD' });
    expect(result).toMatchObject({ status: 'ok', price: { amount: 1299, currency: 'USD' } });
  });

  it('distinguishes missing, empty, and unparseable elements', async () => {
    const rule = { kind: 'selector' as const, selector: '.price' };
    expect((await extractor.extract(page('<p>nothing</p>'), rule, {})).status).toBe('not_found');
    expect((await extractor.extract(page('<span class="price">  </span>'), rule, {})).status).toBe('empty');
    expect((await extractor.extract(page('<span class="price">Call us</span>'), rule, {})).status).toBe('unparseable');
  });
});
