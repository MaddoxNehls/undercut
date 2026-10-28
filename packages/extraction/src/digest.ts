import type { DigestNode } from '@undercut/core';
import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

/** Text that looks like a price: a currency marker next to a number, either order. */
export const PRICE_TEXT =
  /(?:[$€£¥₹₩₽₺₪฿]|\b(?:USD|EUR|GBP|JPY|CAD|AUD|CHF|SEK|NOK|DKK|PLN|INR|BRL|MXN)\b|\bRs\.?)\s?\d|\d[\d.,'\s]*\s?(?:[$€£¥₹₩]|\b(?:USD|EUR|GBP|CHF|kr|zł)\b)/;

const NOISE = 'script, style, noscript, template, svg, iframe, head';
const SEMANTIC = /price|amount|cost|total|was|old|sale|now|current|offer|strike|regular|original|night|per|discount|save|tax|fee|deposit|from/i;
const HASHED = /^(?:css|sc|jsx|emotion|styled)-|[0-9a-f]{5,}|\d{3,}|__[a-z0-9]{5}/i;
const STRUCK_CLASS = /strike|line-through|\bwas\b|\bold\b|original|regular|list-?price|crossed/i;

export interface DigestOptions {
  /** Upper bound on the serialized digest, ~4 characters per token. Default ≈ 2,000 tokens. */
  budgetChars?: number;
  maxNodes?: number;
}

/**
 * A compact, LLM-friendly view of a page: only elements whose text looks like a price, each with
 * a unique CSS path, semantic hints from its ancestors, and a nearby label. Scripts and styles
 * are stripped, and the most price-like nodes are kept within a token budget.
 */
export function buildDigest(html: string, options: DigestOptions = {}): DigestNode[] {
  const $ = load(html);
  $(NOISE).remove();
  const found: { el: Cheerio<Element>; score: number; order: number }[] = [];

  $('body *').each((order, node) => {
    const el = $(node);
    const text = normalize(el.text());
    if (text.length === 0 || text.length > 80 || !PRICE_TEXT.test(text)) return;
    // Keep the deepest element holding the price, not every ancestor of it.
    if (el.children().toArray().some((child) => PRICE_TEXT.test(normalize($(child).text())))) return;
    found.push({ el, score: score(el), order });
  });

  const budget = options.budgetChars ?? 8000;
  const maxNodes = options.maxNodes ?? 60;
  const chosen: { node: DigestNode; order: number }[] = [];
  let used = 0;
  for (const { el, order } of found.sort((a, b) => b.score - a.score || a.order - b.order)) {
    if (chosen.length >= maxNodes) break;
    const node = toNode($, el, `n${chosen.length + 1}`);
    const size = JSON.stringify(node).length;
    if (used + size > budget) continue;
    used += size;
    chosen.push({ node, order });
  }
  // Document order reads naturally (the label of a price usually precedes it).
  return chosen.sort((a, b) => a.order - b.order).map((c, i) => ({ ...c.node, id: `n${i + 1}` }));
}

function toNode($: CheerioAPI, el: Cheerio<Element>, id: string): DigestNode {
  const node: DigestNode = { id, css: cssPath($, el), text: normalize(el.text()).slice(0, 120), hints: hints($, el), struck: isStruck(el) };
  const label = nearbyLabel($, el);
  if (label) node.label = label;
  return node;
}

function score(el: Cheerio<Element>): number {
  const own = `${el.attr('class') ?? ''} ${el.attr('id') ?? ''} ${el.attr('itemprop') ?? ''}`;
  let s = 0;
  if (/price|amount/i.test(own)) s += 3;
  if (el.attr('itemprop') === 'price') s += 3;
  if (el.parents('nav, footer, aside, [class*=related], [class*=recommend]').length > 0) s -= 2;
  if (el.parents('main, article, [class*=product], [id*=product]').length > 0) s += 1;
  return s;
}

/** Shortest unique path, preferring stable ids and classes over positional selectors. */
export function cssPath($: CheerioAPI, el: Cheerio<Element>): string {
  const parts: string[] = [];
  let current: Cheerio<Element> = el;
  while (current.length > 0 && current[0]?.tagName && current[0].tagName !== 'body' && current[0].tagName !== 'html') {
    const node = current[0];
    const id = current.attr('id');
    if (id && !HASHED.test(id) && /^[A-Za-z][\w-]*$/.test(id) && $(`#${id}`).length === 1) {
      parts.unshift(`#${id}`);
      break;
    }
    const testId = current.attr('data-testid');
    if (testId && /^[\w-]+$/.test(testId) && $(`[data-testid="${testId}"]`).length === 1) {
      parts.unshift(`[data-testid="${testId}"]`);
      break;
    }
    let part = node.tagName;
    const classes = (current.attr('class') ?? '').split(/\s+/).filter((c) => c && !HASHED.test(c) && /^[A-Za-z_][\w-]*$/.test(c));
    if (classes.length > 0) part += classes.slice(0, 2).map((c) => `.${c}`).join('');
    const parent = current.parent();
    const twins = parent.children(part);
    if (twins.length > 1) part += `:nth-of-type(${parent.children(node.tagName).index(node) + 1})`;
    parts.unshift(part);
    if ($(parts.join(' > ')).length === 1) break;
    current = parent as Cheerio<Element>;
  }
  return parts.join(' > ');
}

function hints($: CheerioAPI, el: Cheerio<Element>): string[] {
  const out = new Set<string>();
  const chain = [el, ...el.parents().slice(0, 3).toArray().map((p) => $(p))];
  for (const n of chain) {
    const tag = n[0]?.tagName;
    if (tag && /^(del|s|strike|ins|b|strong|small|sup|sub|h1|h2|h3)$/.test(tag)) out.add(tag);
    for (const c of (n.attr('class') ?? '').split(/\s+/)) if (c && !HASHED.test(c) && SEMANTIC.test(c)) out.add(c.slice(0, 40));
    for (const attr of ['id', 'itemprop', 'data-testid', 'aria-label']) {
      const v = n.attr(attr);
      if (v && SEMANTIC.test(v) && !HASHED.test(v)) out.add(`${attr}=${v}`.slice(0, 40));
    }
  }
  return [...out].slice(0, 8);
}

function isStruck(el: Cheerio<Element>): boolean {
  const nearby = [el, el.parent()];
  return nearby.some(
    (n) =>
      /^(del|s|strike)$/.test(n[0]?.tagName ?? '') ||
      /line-through/.test(n.attr('style') ?? '') ||
      STRUCK_CLASS.test(n.attr('class') ?? ''),
  );
}

/** Short text right before the price (previous sibling, or the parent's own words). */
function nearbyLabel($: CheerioAPI, el: Cheerio<Element>): string | undefined {
  const own = normalize(el.text());
  const candidates = [normalize(el.prev().text()), normalize(el.parent().text()).replace(own, '').trim(), normalize(el.next().text())];
  const label = candidates.find((t) => t.length > 0 && t.length <= 60 && !PRICE_TEXT.test(t));
  return label?.slice(0, 80);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
