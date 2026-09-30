import { defineBackground } from 'wxt/utils/define-background';
import { browser } from 'wxt/browser';
import type { DnrRule, ManagedConfig, Ruleset } from '@aioff/core';
import { acceptFeed, addCounts, compareVersions, compileDnr, effectiveSettings, inSchedule, verifySignature } from '@aioff/core';
import embeddedJson from '@aioff/rules';
import publicKeysJson from '@aioff/rules/public-keys';
import {
  FEED_INTERVAL_MINUTES,
  FEED_SIG_URL,
  FEED_URL,
  LISTS_INTERVAL_MINUTES,
  MANAGED_CONFIG_INTERVAL_MINUTES,
  SYNC_INTERVAL_MINUTES,
} from '../lib/constants';
import { getStore, mergeManaged, setStore, updateSettings, type Message } from '../lib/storage';
import { pullSettings, pushSettings } from '../lib/sync';

const embedded = embeddedJson as unknown as Ruleset;
const PUBLIC_KEYS: string[] = (publicKeysJson as { keys: { publicKey: string }[] }).keys.map((k) => k.publicKey);
const ALL_SITES = { origins: ['*://*/*'] };
const ALL_SITES_SCRIPT_ID = 'aioff-all-sites';

export default defineBackground(() => {
  // ---------- ruleset lifecycle ----------

  async function ensureRuleset(): Promise<Ruleset> {
    const { ruleset } = await getStore('ruleset');
    if (ruleset && compareVersions(ruleset.version, embedded.version) >= 0) return ruleset;
    await setStore({
      ruleset: embedded,
      feed: { version: embedded.version, source: 'embedded', checkedAt: null, updatedAt: Date.now(), lastError: null },
    });
    return embedded;
  }

  async function checkFeed(): Promise<void> {
    const current = await ensureRuleset();
    const { feed } = await getStore('feed');
    const status = feed ?? { version: current.version, source: 'embedded' as const, checkedAt: null, updatedAt: null, lastError: null };
    try {
      const [rulesRes, sigRes] = await Promise.all([
        fetch(FEED_URL, { cache: 'no-cache', credentials: 'omit' }),
        fetch(FEED_SIG_URL, { cache: 'no-cache', credentials: 'omit' }),
      ]);
      if (!rulesRes.ok || !sigRes.ok) throw new Error(`feed HTTP ${rulesRes.status}/${sigRes.status}`);
      const payload = new Uint8Array(await rulesRes.arrayBuffer());
      const sig = (await sigRes.text()).trim();
      const result = await acceptFeed(payload, sig, {
        publicKeys: PUBLIC_KEYS,
        currentVersion: current.version,
        extensionVersion: browser.runtime.getManifest().version,
      });
      if (!result.ok) {
        // An older or unsigned feed is never applied. Older is also not an error worth showing.
        await setStore({
          feed: { ...status, checkedAt: Date.now(), lastError: result.reason === 'older-version' ? null : result.reason },
        });
        return;
      }
      const changed = result.ruleset.version !== current.version;
      await setStore({
        ...(changed ? { ruleset: result.ruleset } : {}),
        feed: {
          version: result.ruleset.version,
          source: 'remote',
          checkedAt: Date.now(),
          updatedAt: changed ? Date.now() : status.updatedAt,
          lastError: null,
        },
      });
    } catch (e) {
      await setStore({ feed: { ...status, checkedAt: Date.now(), lastError: String((e as Error).message ?? e) } });
    }
  }

  // ---------- Level 3 lists (uBlacklist format, fetched only at Level 3+) ----------

  async function refreshLists(force = false): Promise<void> {
    const { settings, ruleset, lists, managed, managedRemote } = await getStore('settings', 'ruleset', 'lists', 'managed', 'managedRemote');
    if (!ruleset) return;
    const eff = effectiveSettings(settings, mergeManaged(managed, managedRemote));
    if (eff.level < ruleset.provenance.level) return;
    if (!force && lists?.fetchedAt && Date.now() - lists.fetchedAt < LISTS_INTERVAL_MINUTES * 60_000) return;
    const grab = async (urls: string[]) => {
      const lines: string[] = [];
      for (const url of urls) {
        try {
          const res = await fetch(url, { credentials: 'omit' });
          if (res.ok) lines.push(...(await res.text()).split('\n').slice(0, 200_000));
        } catch {
          /* a list being down must never break anything */
        }
      }
      return lines;
    };
    await setStore({
      lists: {
        fetchedAt: Date.now(),
        domainLines: await grab(ruleset.provenance.domainLists),
        channelLines: await grab(ruleset.provenance.youtubeChannelLists),
      },
    });
  }

  // ---------- managed (schools and organizations) ----------

  async function readManaged(): Promise<void> {
    let managed: ManagedConfig | null = null;
    try {
      const raw = (await browser.storage.managed.get(null)) as ManagedConfig;
      if (raw && Object.keys(raw).length) managed = raw;
    } catch {
      /* Firefox throws when no managed storage manifest exists. That just means unmanaged. */
    }
    await setStore({ managed });
    if (!managed?.configUrl) await setStore({ managedRemote: null });
  }

  async function fetchManagedRemote(): Promise<void> {
    const { managed } = await getStore('managed');
    const url = managed?.configUrl;
    if (!url || !/^https:\/\//.test(url)) return;
    try {
      const [res, sigRes] = await Promise.all([
        fetch(url, { cache: 'no-cache', credentials: 'omit' }),
        fetch(url + '.sig', { cache: 'no-cache', credentials: 'omit' }),
      ]);
      if (!res.ok || !sigRes.ok) return;
      const payload = new Uint8Array(await res.arrayBuffer());
      if (!(await verifySignature(payload, (await sigRes.text()).trim(), PUBLIC_KEYS))) return;
      const remote = JSON.parse(new TextDecoder().decode(payload)) as ManagedConfig;
      delete remote.configUrl; // a hosted config may not redirect itself
      await setStore({ managedRemote: remote });
    } catch {
      /* keep the last known config */
    }
  }

  // ---------- declarativeNetRequest ----------

  async function syncDnr(): Promise<void> {
    const { settings, ruleset, managed, managedRemote } = await getStore('settings', 'ruleset', 'managed', 'managedRemote');
    if (!ruleset) return;
    const m = mergeManaged(managed, managedRemote);
    const eff = effectiveSettings(settings, m);
    const scheduled = inSchedule(m);
    const hasAllSites = await browser.permissions.contains(ALL_SITES).catch(() => false);
    // Redirects need host access. With it, Blackout shows AI Off's own page and carries the blocked URL along.
    const attempts: DnrRule[][] = !scheduled
      ? [[]]
      : hasAllSites
        ? [
            compileDnr(ruleset, eff, { managed: m, blockedPagePath: '/blocked.html', blockedPageUrl: browser.runtime.getURL('/blocked.html') }),
            compileDnr(ruleset, eff, { managed: m, blockedPagePath: '/blocked.html' }),
            compileDnr(ruleset, eff, { managed: m }),
          ]
        : [compileDnr(ruleset, eff, { managed: m })];
    // The browser installs a batch whole or not at all. If it refuses one (a rule form this browser does not
    // support, a domain it will not accept), step down rather than lose every network rule.
    let lastError: string | null = null;
    for (const next of attempts) {
      try {
        const existing = await browser.declarativeNetRequest.getDynamicRules();
        await browser.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: existing.map((r) => r.id),
          addRules: next as unknown as Parameters<typeof browser.declarativeNetRequest.updateDynamicRules>[0]['addRules'],
        });
        lastError = null;
        break;
      } catch (e) {
        lastError = String((e as Error).message ?? e);
      }
    }
    if (lastError) {
      const { feed } = await getStore('feed');
      if (feed) await setStore({ feed: { ...feed, lastError: `network rules: ${lastError}` } });
    }
    await syncBadge();
  }

  async function syncBadge(): Promise<void> {
    const { settings, managed, managedRemote } = await getStore('settings', 'managed', 'managedRemote');
    const eff = effectiveSettings(settings, mergeManaged(managed, managedRemote));
    const paused = !!eff.pauseUntil && eff.pauseUntil > Date.now();
    const text = !eff.enabled ? 'ON' : paused ? 'II' : '';
    await browser.action.setBadgeText({ text });
    await browser.action.setBadgeBackgroundColor({ color: '#5d5a52' });
    await browser.action.setTitle({
      title: !eff.enabled ? 'AI Off is switched off. AI is on.' : paused ? 'AI Off is paused' : 'AI Off: AI is off',
    });
  }

  // ---------- optional all-sites access ----------

  async function syncAllSitesScript(): Promise<void> {
    const has = await browser.permissions.contains(ALL_SITES).catch(() => false);
    const registered = await browser.scripting.getRegisteredContentScripts({ ids: [ALL_SITES_SCRIPT_ID] }).catch(() => []);
    if (has && !registered.length) {
      await browser.scripting.registerContentScripts([
        {
          id: ALL_SITES_SCRIPT_ID,
          js: ['content-scripts/content.js'],
          matches: ['*://*/*'],
          runAt: 'document_start',
          persistAcrossSessions: true,
        },
      ]);
    } else if (!has && registered.length) {
      await browser.scripting.unregisterContentScripts({ ids: [ALL_SITES_SCRIPT_ID] });
    }
    await syncDnr();
  }

  // ---------- stats ----------

  let pending: { siteId: string; ruleId: string; n: number }[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  async function flushCounts(): Promise<void> {
    flushTimer = null;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    const { stats } = await getStore('stats');
    await setStore({ stats: addCounts(stats, batch) });
  }

  // ---------- Pro sync (opt-in) ----------

  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  function schedulePush(): void {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void pushSettings();
    }, 20_000);
  }
  async function pullIfEnabled(): Promise<void> {
    const { pro } = await getStore('pro');
    if (pro.sync.enabled) await pullSettings();
  }

  // ---------- wiring ----------

  // Runs on every service worker wake, so it stays local, cheap, and idempotent. Network work lives on the alarms.
  async function boot(): Promise<void> {
    await ensureRuleset();
    await readManaged();
    await syncDnr();
    await syncAllSitesScript();
  }
  // Install and browser start also pull the encrypted settings once, if sync is on. The sync alarm does the rest.
  async function bootAndPull(): Promise<void> {
    await boot();
    await pullIfEnabled();
  }

  browser.runtime.onInstalled.addListener(async () => {
    await bootAndPull();
    await browser.alarms.create('feed', { delayInMinutes: 1, periodInMinutes: FEED_INTERVAL_MINUTES });
    await browser.alarms.create('managed', { delayInMinutes: 1, periodInMinutes: MANAGED_CONFIG_INTERVAL_MINUTES });
    await browser.alarms.create('lists', { delayInMinutes: 2, periodInMinutes: LISTS_INTERVAL_MINUTES });
    await browser.alarms.create('sync', { delayInMinutes: 3, periodInMinutes: SYNC_INTERVAL_MINUTES });
  });
  browser.runtime.onStartup.addListener(bootAndPull);

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'feed') await checkFeed();
    else if (alarm.name === 'managed') {
      await fetchManagedRemote();
      await syncDnr(); // also re-evaluates schedules and exam windows
    } else if (alarm.name === 'lists') await refreshLists();
    else if (alarm.name === 'sync') await pullIfEnabled();
    else if (alarm.name === 'pause-end') {
      await updateSettings((s) => ({ ...s, pauseUntil: null }));
    }
  });

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'managed') {
      await readManaged();
      await fetchManagedRemote();
      return;
    }
    if (area !== 'local') return;
    if (changes.settings || changes.ruleset || changes.managed || changes.managedRemote) {
      await syncDnr();
      const until = (changes.settings?.newValue as { pauseUntil?: number | null } | undefined)?.pauseUntil;
      if (until && until > Date.now()) await browser.alarms.create('pause-end', { when: until });
    }
    if (changes.settings) await refreshLists();
    // A local settings edit (a pull writes settings and pro together, so it carries no "pro" change).
    if (changes.settings && !changes.pro) {
      const { pro } = await getStore('pro');
      if (pro.sync.enabled) {
        await setStore({ pro: { ...pro, sync: { ...pro.sync, localUpdatedAt: Date.now() } } });
        schedulePush();
      }
    }
  });

  browser.permissions.onAdded.addListener(syncAllSitesScript);
  browser.permissions.onRemoved.addListener(syncAllSitesScript);

  browser.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const msg = raw as Message;
    switch (msg.type) {
      case 'count':
        pending.push(...msg.increments);
        flushTimer ??= setTimeout(flushCounts, 1500);
        return;
      case 'insertCss':
      case 'removeCss': {
        // USER origin CSS cannot be overridden by the page and is not subject to the page CSP.
        const tabId = sender.tab?.id;
        if (tabId == null) return;
        const target = { tabId, frameIds: [sender.frameId ?? 0] };
        const call = msg.type === 'insertCss' ? browser.scripting.insertCSS : browser.scripting.removeCSS;
        call({ target, css: msg.css, origin: 'USER' }).catch(() => {});
        return;
      }
      case 'startPicker':
        browser.scripting
          .executeScript({ target: { tabId: msg.tabId }, files: ['/picker.js'] })
          .then(() => sendResponse({ ok: true }))
          .catch((e) => sendResponse({ ok: false, error: String(e) }));
        return true;
      case 'saveUserRule':
        updateSettings((s) => ({
          ...s,
          userRules: [
            ...s.userRules.filter((r) => !(r.host === msg.host && r.selector === msg.selector)),
            { host: msg.host, selector: msg.selector, note: msg.note, created: new Date().toISOString().slice(0, 10) },
          ],
        })).then(() => sendResponse({ ok: true }));
        return true;
      case 'checkFeedNow':
        checkFeed().then(() => sendResponse({ ok: true }));
        return true;
      case 'allSitesChanged':
        syncAllSitesScript().then(() => sendResponse({ ok: true }));
        return true;
      case 'syncNow':
        (msg.direction === 'push' ? pushSettings() : pullSettings()).then(sendResponse);
        return true;
    }
  });

  // Service workers restart often; make sure state exists whenever we wake.
  void boot();
});
