import { describe, expect, it } from 'vitest';
import { expandPattern, matchesPattern, patternToRe2, toHostPermission } from '../src/index.ts';

const groups = { 'google.*': ['google.com', 'google.de', 'google.co.uk'] };

describe('match patterns', () => {
  it('matches plain hosts and paths', () => {
    expect(matchesPattern('*://www.bing.com/search*', new URL('https://www.bing.com/search?q=x'))).toBe(true);
    expect(matchesPattern('*://www.bing.com/search*', new URL('https://www.bing.com/images'))).toBe(false);
    expect(matchesPattern('*://*.zoom.us/*', new URL('https://app.zoom.us/wc'))).toBe(true);
    expect(matchesPattern('*://*.zoom.us/*', new URL('https://zoom.us/'))).toBe(true);
    expect(matchesPattern('*://x.com/*', new URL('ftp://x.com/'))).toBe(false);
  });

  it('expands wildcard TLDs only through host groups', () => {
    expect(matchesPattern('*://www.google.*/search*', new URL('https://www.google.de/search?q=x'), groups)).toBe(true);
    expect(matchesPattern('*://www.google.*/search*', new URL('https://www.google.co.uk/search?q=x'), groups)).toBe(true);
    // lookalike domains never match
    expect(matchesPattern('*://www.google.*/search*', new URL('https://www.google.evil.com/search?q=x'), groups)).toBe(false);
    expect(matchesPattern('*://www.google.*/search*', new URL('https://www.google.fr/search?q=x'), groups)).toBe(false);
    expect(matchesPattern('*://www.google.*/', new URL('https://www.google.com/'), groups)).toBe(true);
  });

  it('expands to manifest patterns', () => {
    expect(expandPattern('*://www.google.*/search*', groups)).toEqual([
      '*://www.google.com/search*',
      '*://www.google.de/search*',
      '*://www.google.co.uk/search*',
    ]);
    expect(toHostPermission('*://www.google.de/search*')).toBe('*://www.google.de/*');
  });

  it('builds RE2-safe regexes with requestDomains for groups', () => {
    const r = patternToRe2('*://www.google.*/search*', groups, '/search?')!;
    expect(r.requestDomains).toEqual(groups['google.*']);
    expect(r.regex).not.toMatch(/\(\?[!=<]/); // no lookarounds
    const re = new RegExp(r.regex);
    expect(re.test('https://www.google.co.uk/search?q=a')).toBe(true);
    expect(re.test('https://www.google.com/searchbyimage?x')).toBe(false);
    expect(re.test('https://maps.google.com/search?q=a')).toBe(false);
  });
});
