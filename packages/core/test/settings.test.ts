import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isSafeSelector, sanitizeSettings, type Settings } from '../src/index.ts';

describe('sanitizeSettings', () => {
  it('returns the defaults for anything that is not a settings object', () => {
    for (const junk of [undefined, null, 'nope', 42, [1, 2], () => 1]) expect(sanitizeSettings(junk)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps a valid settings object exactly as it is', () => {
    const s: Settings = {
      ...DEFAULT_SETTINGS,
      level: 3,
      pausedSites: ['example.com'],
      pauseUntil: 1234,
      disabledRules: ['g-aio-main'],
      enabledOptionalRules: ['gh-copilot-chat'],
      userMuteTerms: ['blockchain'],
      disabledFeedTerms: ['Codex'],
      userRules: [{ host: 'example.com', selector: '.promo', created: '2026-09-24', note: 'the banner' }],
      provenanceMode: 'badge',
      sound: false,
      showSupportChat: ['shop.example'],
    };
    expect(sanitizeSettings(s)).toEqual(s);
  });

  it('repairs wrong types field by field instead of rejecting the whole object', () => {
    const out = sanitizeSettings({
      enabled: 'yes',
      level: '2',
      pausedSites: null,
      pauseUntil: 'soon',
      disabledRules: 'g-aio-main',
      userMuteTerms: ['ok', 7, '', '  spaced  '],
      provenanceMode: 'maybe',
      sound: 1,
      extra: true,
    });
    expect(out.enabled).toBe(true);
    expect(out.level).toBe(2);
    expect(out.pausedSites).toEqual([]);
    expect(out.pauseUntil).toBeNull();
    expect(out.disabledRules).toEqual([]);
    expect(out.userMuteTerms).toEqual(['ok', 'spaced']);
    expect(out.provenanceMode).toBe('hide');
    expect(out.sound).toBe(true);
    expect('extra' in out).toBe(false);
    expect(sanitizeSettings({ level: 9 }).level).toBe(1);
  });

  it('lowercases hosts and drops duplicates', () => {
    expect(sanitizeSettings({ pausedSites: ['Example.com', 'example.com', ' news.example.com '] }).pausedSites).toEqual(['example.com', 'news.example.com']);
    expect(sanitizeSettings({ showSupportChat: ['Shop.Example'] }).showSupportChat).toEqual(['shop.example']);
  });

  it('drops user rules whose selector could break out of the stylesheet or hide the page', () => {
    const out = sanitizeSettings({
      userRules: [
        { host: 'a.com', selector: '.ok' },
        { host: 'a.com', selector: 'a}body{display:none' },
        { host: 'a.com', selector: 'body' },
        { host: 'a.com', selector: '.x; --evil: 1' },
        { host: '', selector: '.ok' },
        { selector: '.no-host' },
        { host: 'A.com', selector: '.ok' },
        'not an object',
      ],
    });
    expect(out.userRules.map((r) => r.selector)).toEqual(['.ok']);
    expect(out.userRules[0]!.host).toBe('a.com');
    expect(out.userRules[0]!.created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('isSafeSelector agrees with the feed lint', () => {
    expect(isSafeSelector('[data-testid="ask-ai"]')).toBe(true);
    expect(isSafeSelector('div:has(> .ai)')).toBe(true);
    expect(isSafeSelector('*')).toBe(false);
    expect(isSafeSelector('html')).toBe(false);
    expect(isSafeSelector(' body ')).toBe(false);
    expect(isSafeSelector('.a{')).toBe(false);
    expect(isSafeSelector('')).toBe(false);
  });
});
