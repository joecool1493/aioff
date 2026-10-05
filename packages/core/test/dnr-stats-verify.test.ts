import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { acceptFeed, addCounts, bySite, compileDnr, compileDnrLadder, DEFAULT_SETTINGS, EMPTY_STATS, totalSince, validDomains, verifySignature, type Ruleset } from '../src/index.ts';

const base: Ruleset = {
  version: '2026.9.20.1',
  minExtensionVersion: '0.1.0',
  hostGroups: { 'google.*': ['google.com', 'google.de'] },
  sites: [
    {
      id: 'search-google',
      name: 'Google',
      category: 'search',
      match: ['*://www.google.*/search*', '*://www.google.*/'],
      level: 1,
      rules: [{ id: 'g-web', kind: 'urlRewrite', when: { paramMissing: ['udm', 'tbm'], pathPrefix: '/search?' }, set: { udm: '14' }, description: 'force web tab' }],
    },
  ],
  network: [
    { id: 'ads', kind: 'block', level: 1, description: 'ads', domains: ['api.ads.openai.com'] },
    { id: 'blackout', kind: 'block', level: 4, description: 'blackout', domains: ['chatgpt.com', 'claude.ai'], blockNavigation: true },
  ],
  mute: { level: 2, terms: ['AI'], exclusions: [], matchMode: 'wordBoundary', containers: {}, genericContainers: [], headlineSelectors: [], ads: { slotSelectors: [], landingDomains: [] } },
  provenance: { level: 3, hideC2paGenerative: true, generativeSourceTypes: [], editedSourceTypes: [], minImagePixels: 0, domainLists: [], youtubeChannelLists: [], starterDomains: [], starterYoutubeChannels: [], resultContainers: [], platformLabels: [] },
};

describe('compileDnr', () => {
  it('emits nothing when the switch is off or paused', () => {
    expect(compileDnr(base, { ...DEFAULT_SETTINGS, enabled: false })).toEqual([]);
    expect(compileDnr(base, { ...DEFAULT_SETTINGS, pauseUntil: Date.now() + 5000 })).toEqual([]);
  });

  it('level 1: ad block plus the rewrite pair (allow when param present, else redirect)', () => {
    const rules = compileDnr(base, DEFAULT_SETTINGS);
    expect(rules.filter((r) => r.action.type === 'block').length).toBe(1);
    const allows = rules.filter((r) => r.action.type === 'allow');
    const redirects = rules.filter((r) => r.action.type === 'redirect');
    expect(allows.length).toBe(2); // udm, tbm; the two match patterns collapse to one regex
    expect(redirects.length).toBe(1);
    expect(allows.every((a) => a.priority > redirects[0]!.priority)).toBe(true);
    expect(redirects[0]!.condition.requestDomains).toEqual(['google.com', 'google.de']);
    expect(redirects[0]!.condition.resourceTypes).toEqual(['main_frame']);
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    // behavior check of the pair
    const url = 'https://www.google.com/search?q=a&udm=2';
    expect(allows.some((a) => new RegExp(a.condition.regexFilter!).test(url))).toBe(true);
    expect(allows.some((a) => new RegExp(a.condition.regexFilter!).test('https://www.google.com/search?q=sudm=1'))).toBe(false);
  });

  it('level 4 adds the blackout block and the blocked page when allowed', () => {
    const rules = compileDnr(base, { ...DEFAULT_SETTINGS, level: 4 }, { blockedPagePath: '/blocked.html' });
    const nav = rules.find((r) => r.action.redirect?.extensionPath);
    expect(nav?.condition.requestDomains).toEqual(['chatgpt.com', 'claude.ai']);
    const noPerm = compileDnr(base, { ...DEFAULT_SETTINGS, level: 4 });
    expect(noPerm.filter((r) => r.action.type === 'block').length).toBe(3);
  });

  it('paused sites are carved out', () => {
    const rules = compileDnr(base, { ...DEFAULT_SETTINGS, level: 4, pausedSites: ['claude.ai', 'google.de'] });
    const blackout = rules.find((r) => r.condition.requestDomains?.includes('chatgpt.com'))!;
    expect(blackout.condition.requestDomains).not.toContain('claude.ai');
    const redirect = rules.find((r) => r.action.type === 'redirect')!;
    expect(redirect.condition.excludedRequestDomains).toContain('google.de');
  });

  it('managed extra domains are blocked', () => {
    const rules = compileDnr(base, DEFAULT_SETTINGS, { managed: { denyExtraDomains: ['character.ai'] } });
    expect(rules.some((r) => r.condition.requestDomains?.includes('character.ai'))).toBe(true);
  });

  it('with the page URL, the blackout redirect carries the blocked URL so the page can return to it', () => {
    const rules = compileDnr(base, { ...DEFAULT_SETTINGS, level: 4 }, {
      blockedPagePath: '/blocked.html',
      blockedPageUrl: 'chrome-extension://abc/blocked.html',
      managed: { denyExtraDomains: ['character.ai', 'Bad Domain', 'https://x.ai'] },
    });
    const navs = rules.filter((r) => r.action.redirect?.regexSubstitution);
    expect(navs.length).toBe(2); // the blackout tier and the managed extras
    const url = 'https://chatgpt.com/?q=1&x=2';
    for (const nav of navs) {
      expect(nav.action.redirect?.regexSubstitution).toBe('chrome-extension://abc/blocked.html?u=\\0');
      expect(new RegExp(nav.condition.regexFilter!).exec(url)?.[0]).toBe(url); // \0 is the whole URL
    }
    expect(navs[0]!.condition.requestDomains).toEqual(['chatgpt.com', 'claude.ai']);
    expect(navs[1]!.condition.requestDomains).toEqual(['character.ai']);
    expect(rules.some((r) => r.action.redirect?.extensionPath)).toBe(false);
    // the ad block, the Blackout sub-resource block, and the search rewrite are unchanged by the option
    expect(rules.filter((r) => r.action.type === 'block').length).toBe(2);
    expect(rules.filter((r) => r.action.redirect?.transform).length).toBe(1);
  });

  it('drops malformed domains before they can poison a DNR batch', () => {
    expect(validDomains(['Chatgpt.com', 'chatgpt.com', ' claude.ai ', 'localhost', 'https://x.ai', 'a..b', 42, '', null])).toEqual(['chatgpt.com', 'claude.ai']);
    const rules = compileDnr(base, { ...DEFAULT_SETTINGS, level: 4, pausedSites: ['claude.ai', 'not a domain'] });
    expect(rules.some((r) => r.condition.excludedInitiatorDomains?.includes('claude.ai'))).toBe(true);
    expect(rules.some((r) => r.condition.excludedInitiatorDomains?.includes('not a domain'))).toBe(false);
  });
});

describe('compileDnrLadder', () => {
  const blackout = { ...DEFAULT_SETTINGS, level: 4 as const };
  const page = { blockedPagePath: '/blocked.html', blockedPageUrl: 'chrome-extension://abc/blocked.html' };
  const navActions = (rules: ReturnType<typeof compileDnr>) =>
    rules.filter((r) => r.condition.resourceTypes?.includes('main_frame') && r.condition.requestDomains?.includes('chatgpt.com')).map((r) => r.action);

  it('steps down from the redirect that carries the URL, to the plain redirect, to a block', () => {
    const ladder = compileDnrLadder(base, blackout, { hostAccess: true, ...page });
    expect(ladder).toHaveLength(3);
    expect(ladder[0]).toEqual(compileDnr(base, blackout, page));
    expect(ladder[1]).toEqual(compileDnr(base, blackout, { blockedPagePath: '/blocked.html' }));
    expect(ladder[2]).toEqual(compileDnr(base, blackout));
  });

  it('never emits regexSubstitution when the browser cannot be trusted with it (Safari)', () => {
    const ladder = compileDnrLadder(base, blackout, { hostAccess: true, regexSubstitution: false, ...page });
    expect(ladder).toHaveLength(2);
    expect(JSON.stringify(ladder)).not.toContain('regexSubstitution');
    expect(navActions(ladder[0]!)).toEqual([{ type: 'redirect', redirect: { extensionPath: '/blocked.html' } }]);
    expect(navActions(ladder[1]!)).toEqual([{ type: 'block' }]);
  });

  it('only blocks without host access, whatever the browser', () => {
    for (const regexSubstitution of [true, false]) {
      const ladder = compileDnrLadder(base, blackout, { hostAccess: false, regexSubstitution, ...page });
      expect(ladder).toHaveLength(1);
      expect(navActions(ladder[0]!)).toEqual([{ type: 'block' }]);
    }
  });

  it('passes managed config through to every step', () => {
    const ladder = compileDnrLadder(base, DEFAULT_SETTINGS, { hostAccess: true, regexSubstitution: false, managed: { denyExtraDomains: ['extra.example'] }, ...page });
    for (const step of ladder) expect(step.some((r) => r.condition.requestDomains?.includes('extra.example'))).toBe(true);
  });
});

describe('stats', () => {
  it('keeps daily counters by site and rule only', () => {
    let s = addCounts(EMPTY_STATS, [{ siteId: 'x', ruleId: 'grok', n: 2 }], new Date('2026-09-20T12:00:00'));
    s = addCounts(s, [{ siteId: 'x', ruleId: 'grok', n: 3 }, { siteId: 'user', ruleId: 'user:example.com:#secret', n: 1 }], new Date('2026-09-20T13:00:00'));
    s = addCounts(s, [{ siteId: 'g', ruleId: 'aio', n: 10 }], new Date('2026-09-10T13:00:00'));
    expect(totalSince(s, 7, new Date('2026-09-20T18:00:00'))).toBe(6);
    expect(totalSince(s, 30, new Date('2026-09-20T18:00:00'))).toBe(16);
    expect(bySite(s, 7, new Date('2026-09-20T18:00:00'))[0]).toEqual({ siteId: 'x', total: 5 });
    expect(JSON.stringify(s)).not.toContain('secret'); // user selectors never reach stats
  });
});

describe('signed feed', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const payload = new Uint8Array(Buffer.from(JSON.stringify(base)));
  const sig = sign(null, payload, privateKey).toString('base64');
  const opts = { publicKeys: [pub], currentVersion: '2026.9.19.1', extensionVersion: '0.1.0' };

  it('accepts a good signature', async () => {
    expect(await verifySignature(payload, sig, [pub])).toBe(true);
    expect((await acceptFeed(payload, sig, opts)).ok).toBe(true);
  });
  it('rejects tampering, wrong keys, downgrades, and feeds that need a newer extension', async () => {
    const tampered = new Uint8Array(payload);
    tampered[10] = tampered[10]! ^ 1;
    expect(await acceptFeed(tampered, sig, opts)).toEqual({ ok: false, reason: 'bad-signature' });
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    expect(await acceptFeed(payload, sig, { ...opts, publicKeys: [other] })).toEqual({ ok: false, reason: 'bad-signature' });
    expect(await acceptFeed(payload, sig, { ...opts, currentVersion: '2026.9.21.1' })).toEqual({ ok: false, reason: 'older-version' });
    expect(await acceptFeed(payload, sig, { ...opts, extensionVersion: '0.0.9' })).toEqual({ ok: false, reason: 'needs-newer-extension' });
  });
  it('supports key rotation', async () => {
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
    expect(await verifySignature(payload, sig, [other, pub])).toBe(true);
  });
});
