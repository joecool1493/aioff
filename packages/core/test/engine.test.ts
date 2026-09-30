import { describe, expect, it } from 'vitest';
import {
  activeState,
  applyUrlRewrite,
  buildHideCss,
  compareVersions,
  DEFAULT_SETTINGS,
  effectiveSettings,
  inSchedule,
  isLocked,
  resolvePage,
  type Ruleset,
  type UrlRewriteRule,
} from '../src/index.ts';

const ruleset: Ruleset = {
  version: '2026.9.20.1',
  minExtensionVersion: '0.1.0',
  hostGroups: { 'google.*': ['google.com', 'google.de'] },
  sites: [
    {
      id: 'search-google',
      name: 'Google',
      category: 'search',
      match: ['*://www.google.*/search*'],
      level: 1,
      rules: [
        { id: 'g-aio', kind: 'hide', selectors: ['[data-attnms]'], textAnchors: ['AI Overview'], description: 'AI Overview' },
        { id: 'g-l3', kind: 'hide', selectors: ['.slop'], level: 3, description: 'level three thing' },
        { id: 'g-opt', kind: 'hide', selectors: ['.opt'], defaultEnabled: false, description: 'optional thing' },
        { id: 'g-web', kind: 'urlRewrite', when: { paramMissing: ['udm', 'tbm'], pathPrefix: '/search?' }, set: { udm: '14' }, description: 'force web' },
      ],
    },
  ],
  network: [],
  mute: {
    level: 2,
    terms: ['AI'],
    exclusions: [],
    matchMode: 'wordBoundary',
    containers: { 'x.com': ['article'] },
    genericContainers: ['article'],
    headlineSelectors: ['h2'],
    ads: { slotSelectors: [], landingDomains: [] },
  },
  provenance: {
    level: 3,
    hideC2paGenerative: true,
    generativeSourceTypes: [],
    editedSourceTypes: [],
    minImagePixels: 0,
    domainLists: [],
    youtubeChannelLists: [],
    starterDomains: [],
    starterYoutubeChannels: [],
    resultContainers: [],
    platformLabels: [],
  },
};

describe('resolvePage', () => {
  const url = new URL('https://www.google.de/search?q=x');
  it('applies level gating, opt-in rules, and disabled rules', () => {
    expect(resolvePage(ruleset, url, DEFAULT_SETTINGS).hide.map((h) => h.ruleId)).toEqual(['g-aio']);
    expect(resolvePage(ruleset, url, { ...DEFAULT_SETTINGS, level: 3 }).hide.map((h) => h.ruleId)).toEqual(['g-aio', 'g-l3']);
    expect(resolvePage(ruleset, url, { ...DEFAULT_SETTINGS, enabledOptionalRules: ['g-opt'] }).hide.map((h) => h.ruleId)).toEqual(['g-aio', 'g-opt']);
    expect(resolvePage(ruleset, url, { ...DEFAULT_SETTINGS, disabledRules: ['g-aio'] }).hide).toEqual([]);
  });
  it('adds user rules for the host and mute containers by level', () => {
    const s = { ...DEFAULT_SETTINGS, level: 2 as const, userRules: [{ host: 'google.de', selector: '#x', created: '2026-09-20' }] };
    const page = resolvePage(ruleset, url, s);
    expect(page.hide.at(-1)?.selectors).toEqual(['#x']);
    expect(page.muteGeneric).toBe(true);
    expect(resolvePage(ruleset, new URL('https://x.com/home'), s).muteContainers).toEqual(['article']);
    expect(resolvePage(ruleset, new URL('https://x.com/home'), DEFAULT_SETTINGS).muteContainers).toEqual([]);
  });
  it('does nothing on unknown sites', () => {
    expect(resolvePage(ruleset, new URL('https://example.com/'), DEFAULT_SETTINGS).hide).toEqual([]);
  });
});

describe('url rewrite', () => {
  const rule = ruleset.sites[0]!.rules[3] as UrlRewriteRule;
  it('adds udm=14 only when udm and tbm are missing', () => {
    expect(applyUrlRewrite(rule, new URL('https://www.google.com/search?q=a'))?.searchParams.get('udm')).toBe('14');
    expect(applyUrlRewrite(rule, new URL('https://www.google.com/search?q=a&udm=2'))).toBeNull();
    expect(applyUrlRewrite(rule, new URL('https://www.google.com/search?q=a&tbm=isch'))).toBeNull();
    expect(applyUrlRewrite(rule, new URL('https://www.google.com/searchbyimage?x=1'))).toBeNull();
  });
  it('is idempotent, so it can never loop', () => {
    const once = applyUrlRewrite(rule, new URL('https://www.google.com/search?q=a'))!;
    expect(applyUrlRewrite(rule, once)).toBeNull();
  });
});

describe('state', () => {
  it('reports why it is inactive', () => {
    expect(activeState({ ...DEFAULT_SETTINGS, enabled: false }, 'x.com')).toEqual({ active: false, reason: 'switch-off' });
    expect(activeState({ ...DEFAULT_SETTINGS, pauseUntil: Date.now() + 1000 }, 'x.com')).toEqual({ active: false, reason: 'paused-timer' });
    expect(activeState({ ...DEFAULT_SETTINGS, pausedSites: ['x.com'] }, 'www.x.com')).toEqual({ active: false, reason: 'paused-site' });
    expect(activeState({ ...DEFAULT_SETTINGS, pauseUntil: Date.now() - 1 }, 'x.com').active).toBe(true);
  });
  it('lets managed config override and lock', () => {
    const user = { ...DEFAULT_SETTINGS, enabled: false, level: 1 as const, pausedSites: ['google.com'], pauseUntil: Date.now() + 9e5 };
    const eff = effectiveSettings(user, { orgName: 'Lincoln High', level: 2, locked: true, allowSites: ['khanmigo.org'] });
    expect(eff.enabled).toBe(true);
    expect(eff.level).toBe(2);
    expect(eff.pauseUntil).toBeNull();
    expect(eff.pausedSites).toEqual(['khanmigo.org']);
    expect(isLocked({ orgName: 'x' })).toBe(true);
    expect(isLocked({ orgName: 'x', locked: false })).toBe(false);
    expect(isLocked(null)).toBe(false);
  });
  it('exam mode forces level 4, drops the allow list, and expires', () => {
    const eff = effectiveSettings(DEFAULT_SETTINGS, { level: 1, locked: true, allowSites: ['a.com'], examMode: { enabled: true } });
    expect(eff.level).toBe(4);
    expect(eff.pausedSites).toEqual([]);
    const past = effectiveSettings(DEFAULT_SETTINGS, { level: 1, examMode: { enabled: true, until: '2020-01-01T00:00:00Z' } });
    expect(past.level).toBe(1);
  });
  it('honors schedules in the org timezone', () => {
    const managed = { schedule: { timezone: 'America/Los_Angeles', alwaysOn: false, windows: [{ days: [1, 2, 3, 4, 5], start: '08:00', end: '15:30' }] } };
    expect(inSchedule(managed, new Date('2026-09-21T17:00:00Z'))).toBe(true); // Monday 10:00 PDT
    expect(inSchedule(managed, new Date('2026-09-21T23:00:00Z'))).toBe(false); // Monday 16:00 PDT
    expect(inSchedule(managed, new Date('2026-09-20T17:00:00Z'))).toBe(false); // Sunday
    expect(inSchedule({ schedule: { alwaysOn: true } })).toBe(true);
    expect(inSchedule(null)).toBe(true);
  });
});

describe('misc', () => {
  it('builds one CSS block per selector so a bad selector only voids itself', () => {
    const css = buildHideCss(resolvePage(ruleset, new URL('https://www.google.com/search?q=1'), DEFAULT_SETTINGS).hide);
    expect(css).toContain('[data-attnms]{display:none!important}');
  });
  it('compares feed versions numerically', () => {
    expect(compareVersions('2026.9.20.1', '2026.9.19.7')).toBe(1);
    expect(compareVersions('2026.10.1.1', '2026.9.30.1')).toBe(1);
    expect(compareVersions('2026.9.20.1', '2026.9.20.1')).toBe(0);
    expect(compareVersions('2026.9.20.1', '2026.9.20.2')).toBe(-1);
  });
});
