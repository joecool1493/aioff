import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import {
  activeState,
  applyUrlRewrite,
  buildHideCss,
  compileTerms,
  effectiveSettings,
  effectiveTerms,
  findAiAdSlots,
  Hider,
  HIDDEN_ATTR,
  inSchedule,
  MUTE_CSS,
  Muter,
  observe,
  resolvePage,
  type ResolvedPage,
  type Ruleset,
  type Settings,
} from '@aioff/core';
import { createProvenancePass, PROVENANCE_CSS, type ProvenancePass } from '../lib/provenancePass';
import { getStore, mergeManaged, setStore, type Message } from '../lib/storage';

const STYLE_ID = 'aioff-style';

export default defineContentScript({
  // Placeholder. The real list is derived from the ruleset in wxt.config.ts (build:manifestGenerated),
  // so the ruleset itself is never bundled into the content script.
  matches: ['*://www.google.com/*'],
  runAt: 'document_start',
  async main() {
    // The static registration and the optional all-sites registration can both fire.
    const w = window as unknown as { __aioffLoaded?: boolean };
    if (w.__aioffLoaded) return;
    w.__aioffLoaded = true;

    let teardown: (() => void) | null = null;
    let lastHref = location.href;

    const send = (msg: Message) => browser.runtime.sendMessage(msg).catch(() => {});

    // ---------- counting (batched; only site id and rule id ever leave the page) ----------
    let increments: { siteId: string; ruleId: string; n: number }[] = [];
    let countTimer: ReturnType<typeof setTimeout> | null = null;
    const count = (siteId: string, ruleId: string, n: number) => {
      const hit = increments.find((i) => i.siteId === siteId && i.ruleId === ruleId);
      if (hit) hit.n += n;
      else increments.push({ siteId, ruleId, n });
      countTimer ??= setTimeout(() => {
        countTimer = null;
        const batch = increments;
        increments = [];
        void send({ type: 'count', increments: batch });
      }, 2000);
    };

    function tryUrlRewrite(page: ResolvedPage): boolean {
      // Fallback for browsers where the declarativeNetRequest redirect did not fire.
      for (const rule of page.urlRewrites) {
        const next = applyUrlRewrite(rule, new URL(location.href));
        if (!next) continue;
        const guard = `aioff-rw:${rule.id}`;
        try {
          if (sessionStorage.getItem(guard) === next.href) continue; // never loop
          sessionStorage.setItem(guard, next.href);
        } catch {
          continue;
        }
        location.replace(next.href);
        return true;
      }
      return false;
    }

    function setCookies(page: ResolvedPage): void {
      for (const rule of page.cookies) {
        const c = rule.cookie;
        const host = location.hostname;
        const domain = c.domain.replace(/^\./, '');
        if (host !== domain && !host.endsWith('.' + domain)) continue;
        if (document.cookie.split('; ').includes(`${c.name}=${c.value}`)) continue;
        const maxAge = (c.maxAgeDays ?? 365) * 86400;
        document.cookie = `${c.name}=${c.value}; domain=${c.domain}; path=${c.path ?? '/'}; max-age=${maxAge}; Secure; SameSite=Lax`;
        count(rule.siteId, rule.id, 1);
      }
    }

    async function start(): Promise<void> {
      teardown?.();
      teardown = null;
      const { settings, ruleset, managed, managedRemote, lists, clicked } = await getStore(
        'settings',
        'ruleset',
        'managed',
        'managedRemote',
        'lists',
        'clicked',
      );
      if (!ruleset) return;
      const m = mergeManaged(managed, managedRemote);
      const eff: Settings = effectiveSettings(settings, m);
      if (!activeState(eff, location.hostname).active || !inSchedule(m)) return;

      const page = resolvePage(ruleset as Ruleset, new URL(location.href), eff);
      if (tryUrlRewrite(page)) return;
      setCookies(page);

      const level3 = eff.level >= ruleset.provenance.level;
      const muting = page.muteContainers.length > 0;
      const css = [buildHideCss(page.hide), muting || level3 ? MUTE_CSS : '', level3 ? PROVENANCE_CSS : ''].join('\n');

      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = css;
      (document.head ?? document.documentElement).appendChild(style);
      void send({ type: 'insertCss', css });

      const hider = new Hider(page.hide, count);
      const matcher = compileTerms(effectiveTerms(ruleset.mute, eff.userMuteTerms, eff.disabledFeedTerms), ruleset.mute.exclusions);
      const muter = muting
        ? new Muter({
            containers: page.muteContainers,
            matcher,
            headlineSelectors: page.muteGeneric ? ruleset.mute.headlineSelectors : undefined,
            onMute: () => count('mute', 'keyword-mute', 1),
          })
        : null;
      const provenance: ProvenancePass | null = level3
        ? createProvenancePass({ ruleset, settings: eff, lists, count })
        : null;

      let lastAnchorScan = 0;
      const pass = () => {
        if (location.href !== lastHref) {
          lastHref = location.href;
          void start(); // SPA navigation can change which rules apply
          return;
        }
        // Selector pass every time (cheap). The text-anchor walk at most every 300ms.
        const now = Date.now();
        const anchorsDue = now - lastAnchorScan > 300;
        if (anchorsDue) lastAnchorScan = now;
        hider.scan(document, anchorsDue);
        muter?.scan(document);
        if (muting) {
          for (const { el, reason } of findAiAdSlots(document, ruleset.mute.ads.slotSelectors, ruleset.mute.ads.landingDomains, matcher)) {
            if (el.hasAttribute(HIDDEN_ATTR)) continue;
            el.setAttribute(HIDDEN_ATTR, 'ai-ad');
            el.setAttribute('data-aioff-reason', reason);
            count('ads', 'ai-ad-slot', 1);
          }
        }
        provenance?.scan(document);
        for (const rule of page.clicks) {
          if (clicked[rule.id]) continue;
          try {
            if (rule.onlyIf && !document.querySelector(rule.onlyIf)) continue;
            const target = document.querySelector<HTMLElement>(rule.selector);
            if (!target) continue;
            target.click();
            clicked[rule.id] = Date.now();
            void setStore({ clicked });
            count(rule.siteId, rule.id, 1);
          } catch {
            /* fail safe */
          }
        }
      };

      const onClick = (ev: Event) => Muter.handleClick(ev);
      document.addEventListener('click', onClick, true);
      const stopObserving = observe(document.documentElement, pass, 50);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pass, { once: true });
      pass();

      teardown = () => {
        stopObserving();
        document.removeEventListener('click', onClick, true);
        document.getElementById(STYLE_ID)?.remove();
        void send({ type: 'removeCss', css });
        Hider.revealAll(document);
        Muter.revealAll(document);
        provenance?.revealAll(document);
      };
    }

    // The Switch, the dial, pauses, new rules: all take effect instantly, in both directions.
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.settings || changes.ruleset || changes.managed || changes.managedRemote) void start();
    });

    await start();
  },
});
