import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { activeState, effectiveSettings, hostIsOrUnder, isLocked, sitesForUrl, totalSince, type Level } from '@aioff/core';
import { Counter, Dial, Switch } from '@aioff/ui';
import { RULES_REPO } from '../../lib/constants';
import { mergeManaged, updateSettings } from '../../lib/storage';
import { useStore } from '../../lib/useStore';

const ALL_SITES = { origins: ['*://*/*'] };

export function App() {
  const store = useStore('settings', 'stats', 'managed', 'managedRemote', 'ruleset', 'feed');
  const [tab, setTab] = useState<{ id?: number; url?: string } | null>(null);
  const [hasAllSites, setHasAllSites] = useState(true);

  useEffect(() => {
    void browser.tabs.query({ active: true, currentWindow: true }).then(([t]) => setTab(t ? { id: t.id, url: t.url } : {}));
    void browser.permissions.contains(ALL_SITES).then(setHasAllSites);
  }, []);

  if (!store) return null;
  const managed = mergeManaged(store.managed, store.managedRemote);
  const locked = isLocked(managed);
  const eff = effectiveSettings(store.settings, managed);

  let host = '';
  let pageUrl: URL | null = null;
  try {
    pageUrl = tab?.url ? new URL(tab.url) : null;
    if (pageUrl && /^https?:$/.test(pageUrl.protocol)) host = pageUrl.hostname;
  } catch {
    /* no page */
  }
  const state = activeState(eff, host);
  const sitePaused = !!host && eff.pausedSites.some((h) => hostIsOrUnder(host, h));
  const timerPaused = !!eff.pauseUntil && eff.pauseUntil > Date.now();
  const minutesLeft = timerPaused ? Math.ceil((eff.pauseUntil! - Date.now()) / 60_000) : 0;
  const adapters = pageUrl && store.ruleset ? sitesForUrl(store.ruleset, pageUrl).filter((s) => !s.generic) : [];

  const setLevel = async (level: Level) => {
    // Levels 2 to 4 work everywhere only with all-sites access. Ask at the moment it matters, and ask before
    // any await: permissions.request has to be called from inside the user's click.
    if (level >= 2 && !hasAllSites) {
      const granted = await browser.permissions.request(ALL_SITES).catch(() => false);
      setHasAllSites(granted);
      if (granted) void browser.runtime.sendMessage({ type: 'allSitesChanged' });
    }
    await updateSettings((s) => ({ ...s, level }));
  };

  const statusText = !eff.enabled
    ? 'AI is on'
    : timerPaused
      ? `Paused, ${minutesLeft} min left`
      : sitePaused
        ? `Paused on ${host}`
        : 'AI is off';

  const report = () => {
    const params = new URLSearchParams({
      template: 'broken-page.md',
      labels: 'rule-broken',
      title: `Broken page: ${host || 'unknown site'}`,
      body: `### Site\n${host}\n\n### What broke?\n\n\n### Versions\nExtension ${browser.runtime.getManifest().version}, rules ${store.feed?.version ?? store.ruleset?.version ?? 'unknown'}, level ${eff.level}\nActive adapters: ${adapters.map((a) => a.id).join(', ') || 'none'}`,
    });
    void browser.tabs.create({ url: `https://github.com/${RULES_REPO}/issues/new?${params}` });
  };

  const pick = async () => {
    if (tab?.id == null) return;
    await browser.runtime.sendMessage({ type: 'startPicker', tabId: tab.id });
    window.close();
  };

  return (
    <div className="pop">
      <div className="pop__head">
        <span className="pop__brand">AI OFF</span>
        <span className={`pop__status ${state.active ? 'is-off' : ''}`}>{statusText}</span>
      </div>

      {managed && (
        <div className="pop__managed" role="status">
          Managed by <strong>{managed.orgName ?? 'your organization'}</strong>.
          {locked ? ' Settings are locked on this device.' : ''}
          {managed.examMode?.enabled ? ' Exam mode is on.' : ''}
        </div>
      )}

      <div className="pop__switch">
        <Switch
          aiOff={eff.enabled}
          locked={locked}
          sound={store.settings.sound}
          onChange={(aiOff) => updateSettings((s) => ({ ...s, enabled: aiOff, pauseUntil: null }))}
        />
      </div>

      <Dial level={eff.level} onChange={setLevel} locked={locked} disabled={!eff.enabled} />

      {eff.level >= 2 && !hasAllSites && !locked && (
        <p className="pop__note">
          Levels 2 to 4 only reach the built-in site list until you allow AI Off on all sites.{' '}
          <button onClick={() => setLevel(eff.level)}>Allow</button>
        </p>
      )}

      <Counter count={totalSince(store.stats, 7)} />

      <div className="pop__row">
        <button
          className={`act ${sitePaused ? 'is-active' : ''}`}
          disabled={locked || !host}
          onClick={() =>
            updateSettings((s) => ({
              ...s,
              pausedSites: sitePaused ? s.pausedSites.filter((h) => !hostIsOrUnder(host, h)) : [...s.pausedSites, host],
            }))
          }
        >
          {sitePaused ? 'Resume on this site' : 'Pause on this site'}
        </button>
        <button
          className={`act ${timerPaused ? 'is-active' : ''}`}
          disabled={locked}
          onClick={() => updateSettings((s) => ({ ...s, pauseUntil: timerPaused ? null : Date.now() + 15 * 60_000 }))}
        >
          {timerPaused ? 'Resume now' : 'Pause for 15 minutes'}
        </button>
        <button className="act" disabled={!host} onClick={pick}>
          Pick an AI element
        </button>
        <button className="act" disabled={!host} onClick={report}>
          AI Off broke this page?
        </button>
      </div>

      <div className="pop__links">
        <button onClick={() => browser.runtime.openOptionsPage()}>Settings and stats</button>
        <span>Rules {store.feed?.version ?? store.ruleset?.version ?? ''}</span>
      </div>
    </div>
  );
}
