import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PriceCandidate } from '@undercut/core';
import { LLM, ReplayBackend } from '@undercut/llm';
import { describe, expect, it } from 'vitest';
import { ambiguity, buildDigest, decideHeal, discover, healingPayload, heuristicCandidates, inferMeaning, llmCandidates } from '../src/index';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const replay = (name: string) => new LLM(new ReplayBackend(fileURLToPath(new URL(`./fixtures/replay/${name}`, import.meta.url))));

describe('buildDigest', () => {
  it('keeps only price-looking leaf elements, with unique paths, hints, labels, and strike-through', () => {
    const digest = buildDigest(fixture('shop-v1.html'));
    expect(digest.map((n) => n.text)).toEqual(['Cart: $0.00', '$129.99', '$159.99', '$24.99']);
    expect(digest[1]).toMatchObject({ css: 'span.price-now', label: 'Now', struck: false });
    expect(digest[2]).toMatchObject({ css: 'del.price-was', struck: true });
  });

  it('prefers a unique data-testid over positional paths', () => {
    expect(buildDigest(fixture('shop-v2.html'))[1]?.css).toBe('[data-testid="buybox-amount"]');
  });

  it('respects the token budget', () => {
    const full = buildDigest(fixture('shop-v1.html'));
    const tight = buildDigest(fixture('shop-v1.html'), { budgetChars: 300 });
    expect(tight.length).toBeLessThan(full.length);
    expect(JSON.stringify(tight).length).toBeLessThanOrEqual(300 + tight.length * 12);
  });

  it('ignores prices inside scripts and styles', () => {
    const html = '<body><script>var p="$99.00"</script><style>.x:after{content:"$5"}</style><p class="price">$12.00</p></body>';
    expect(buildDigest(html).map((n) => n.text)).toEqual(['$12.00']);
  });
});

describe('heuristics (no LLM)', () => {
  it('trusts structured data when JSON-LD and OpenGraph agree', async () => {
    const candidates = await heuristicCandidates(fixture('json-ld.html'));
    expect(candidates[0]).toMatchObject({ source: 'json-ld', rule: { kind: 'json-ld', field: 'price' }, price: { amount: 1299, currency: 'USD' } });
    expect(candidates.some((c) => c.source === 'opengraph')).toBe(true);
    expect(ambiguity(candidates)).toBeNull();
  });

  it('flags disagreeing class-pattern prices as ambiguous', async () => {
    expect(ambiguity(await heuristicCandidates(fixture('shop-v1.html')))).toBe('heuristics disagree: 129.99 vs 24.99');
  });

  it.each([
    [{ text: '$159.99', hints: ['del'], struck: true }, 'was'],
    [{ text: '$5,196', label: 'Total for 4 nights', hints: [], struck: false }, 'total'],
    [{ text: '$433/night', hints: [], struck: false }, 'per_unit'],
    [{ text: '$129.99', label: 'Now', hints: ['price-now'], struck: false }, 'current'],
  ] as const)('infers meaning %#', (context, meaning) => {
    expect(inferMeaning(context)).toBe(meaning);
  });
});

describe('discover', () => {
  it('skips the LLM entirely when heuristics agree', async () => {
    const llm = replay('shop-v1.json');
    const result = await discover(fixture('json-ld.html'), { url: 'https://resort.test/suite', llm });
    expect(result).toMatchObject({ usedLlm: false, reason: 'heuristics agree on one price' });
    expect(llm.usage.calls).toBe(0);
  });

  it('asks the LLM when heuristics are ambiguous and re-validates its picks against the page', async () => {
    const llm = replay('shop-v1.json');
    const result = await discover(fixture('shop-v1.html'), { url: 'http://127.0.0.1:5450/pack', llm });
    expect(result.usedLlm).toBe(true);
    expect(result.candidates[0]).toMatchObject({ rule: { selector: 'span.price-now' }, meaning: 'current', price: { amount: 129.99 } });
    expect(llm.usage).toMatchObject({ calls: 1, liveCalls: 0 });
  });

  it('degrades to heuristics when no LLM is configured', async () => {
    const result = await discover(fixture('shop-v1.html'), { url: 'http://127.0.0.1:5450/pack' });
    expect(result).toMatchObject({ usedLlm: false, reason: 'heuristics disagree: 129.99 vs 24.99; no LLM configured' });
  });

  it('maps LLM node ids to our own CSS paths and ignores ids not in the digest', async () => {
    const digest = buildDigest(fixture('shop-v1.html')).slice(0, 2);
    const candidates = await llmCandidates(replay('shop-v1.json'), { tag: 'discover/127.0.0.1', url: 'x', digest, parse: {} });
    expect(candidates.map((c) => c.rule)).toEqual([{ kind: 'selector', selector: 'span.price-now' }]);
  });
});

describe('healing', () => {
  it('builds a payload a collector can send: digest plus validated heuristics', async () => {
    const payload = await healingPayload(fixture('shop-v2.html'), {});
    expect(payload.candidates).toEqual([]);
    expect(payload.digest.find((n) => n.css === '[data-testid="buybox-amount"]')?.text).toBe('$129.99');
  });

  const candidate = (amount: number, meaning: PriceCandidate['meaning'] = 'current'): PriceCandidate => ({
    rule: { kind: 'selector', selector: `.p${amount}` },
    source: 'llm',
    meaning,
    confidence: 0.9,
    price: { amount, currency: 'USD', kind: 'exact' },
  });

  it.each([
    ['same price, same meaning', 129.99, [candidate(129.99)], 'apply'],
    ['small drift within 15%', 129.99, [candidate(119.99)], 'apply'],
    ['large drift', 129.99, [candidate(24.99)], 'review'],
    ['only a "was" price matches the value', 129.99, [candidate(129.99, 'was')], 'review'],
    ['no history to compare', null, [candidate(129.99)], 'review'],
    ['no candidates', 129.99, [], 'review'],
  ] as const)('%s -> %s', (_label, lastKnownPrice, candidates, action) => {
    expect(decideHeal({ lastKnownPrice, meaning: 'current', candidates: [...candidates] }).action).toBe(action);
  });
});
