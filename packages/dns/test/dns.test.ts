import { describe, expect, it } from 'vitest';
import { dedupeSubdomains, FORMATS, guardViolations, neverBlock, render, tier } from '../src/index.ts';

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
});
