import { describe, expect, it } from 'vitest';
import { dedupeSubdomains, FORMATS, guardViolations, neverBlock, render, ruleCount, SHORT_RULE_LIMIT, shortOutsideProducts, tier, TIERS } from '../src/index.ts';

describe('dns lists', () => {
  it('never lists a domain that would take down a non-AI service', () => {
    expect(guardViolations()).toEqual([]);
    const all = [...tier('ads'), ...tier('products')].map((e) => e.domain);
    for (const n of ['google.com', 'bing.com', 'github.com', 'microsoft.com', 'x.com', 'duckduckgo.com']) {
      expect(neverBlock()).toContain(n);
      expect(all).not.toContain(n);
    }
  });
  it('keeps developer infrastructure and AI detectors out of Blackout', () => {
    const products = tier('products').map((e) => e.domain);
    expect(products).toContain('chatgpt.com');
    expect(products).toContain('claude.ai');
    expect(products).not.toContain('huggingface.co');
    expect(products).not.toContain('gptzero.me');
  });
  it('dedupes subdomains for formats that match them anyway', () => {
    expect(dedupeSubdomains(['openai.com', 'api.openai.com', 'chatgpt.com'])).toEqual(['openai.com', 'chatgpt.com']);
  });
  it('renders every format', () => {
    for (const f of FORMATS) {
      const out = render('ads', f.format, 'test');
      expect(out.length).toBeGreaterThan(50);
      expect(out).not.toContain(String.fromCharCode(0x2014));
    }
    expect(render('products', 'hosts', 't')).toMatch(/^0\.0\.0\.0 chatgpt\.com$/m);
    expect(render('products', 'adguard', 't')).toMatch(/^\|\|chatgpt\.com\^$/m);
    expect(render('products', 'unbound', 't')).toContain('local-zone: "chatgpt.com." always_nxdomain');
    expect(JSON.parse(render('products', 'controld', 't')).rules.length).toBeGreaterThan(100);
    expect(render('products', 'hosts', 't')).toContain('WARNING');
  });
  it('keeps the short Blackout list a subset of Blackout', () => {
    const products = new Set(tier('products').map((e) => e.domain));
    const short = tier('products-short').map((e) => e.domain);
    expect(short.length).toBeGreaterThan(0);
    for (const d of short) expect(products.has(d)).toBe(true);
    expect(shortOutsideProducts()).toEqual([]);
    expect(short).toContain('chatgpt.com');
    expect(short).toContain('claude.ai');
    for (const e of tier('products-short')) expect(['api', 'cdn', 'dev', 'code']).not.toContain(e.category);
    for (const n of neverBlock()) expect(short).not.toContain(n);
    expect(guardViolations()).toEqual([]);
  });
  it('fits the ads list plus the short Blackout list in a 100-rule plan', () => {
    const rules = (out: string) => out.split('\n').filter((l) => l.startsWith('||'));
    const ads = rules(render('ads', 'adguard', 't'));
    const short = rules(render('products-short', 'adguard', 't'));
    expect(ads.length).toBe(ruleCount('ads'));
    expect(short.length).toBe(ruleCount('products-short'));
    expect(SHORT_RULE_LIMIT).toBe(100);
    expect(ads.length + short.length).toBeLessThanOrEqual(SHORT_RULE_LIMIT);
    expect(short.length).toBeLessThanOrEqual(75);
  });
  it('renders the short tier in every format with its title and warning', () => {
    expect(TIERS).toEqual(['ads', 'products', 'products-short']);
    for (const f of FORMATS) expect(render('products-short', f.format, 't').length).toBeGreaterThan(50);
    const out = render('products-short', 'adguard', 't');
    expect(out).toMatch(/^! Title: AI Off Blackout, short$/m);
    expect(out).toContain('WARNING');
    expect(out).toMatch(/^\|\|openai\.com\^$/m);
    expect(out).not.toMatch(/^\|\|chat\.openai\.com\^$/m);
    expect(render('products-short', 'hosts', 't')).toMatch(/^0\.0\.0\.0 chat\.openai\.com$/m);
  });
});
