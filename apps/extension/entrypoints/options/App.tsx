import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  bySite,
  bytesToBase64,
  DEFAULT_PRO,
  deriveSyncKeys,
  effectiveSettings,
  isLocked,
  sanitizeSettings,
  totalSince,
  verifyLicense,
  type HideRule,
  type Level,
  type LicenseResult,
  type ProState,
  type Ruleset,
  type Settings,
} from '@aioff/core';
import publicKeysJson from '@aioff/rules/public-keys';
import { Dial, LEVELS, RuleExplainer, Switch } from '@aioff/ui';
import { FEED_URL, SITE_URL } from '../../lib/constants';
import { gmailFiltersXml, outlookRuleText } from '../../lib/gmailFilters';
import { mergeManaged, setStore, updateSettings } from '../../lib/storage';
import { useStore } from '../../lib/useStore';

const ALL_TABS = ['General', 'Rules', 'Words', 'Sites', 'Stats', 'Email', 'Pro', 'Backup', 'About'] as const;
// The App Store does not allow a link to a purchase made elsewhere, and the Pro tab is where the key is bought
// and entered, so the Safari build leaves the tab out. Everything else in the extension is free and identical.
const SAFARI = import.meta.env.BROWSER === 'safari';
const TABS = ALL_TABS.filter((t) => !(SAFARI && t === 'Pro'));
const PUBLIC_KEYS = (publicKeysJson as { keys: { publicKey: string }[] }).keys.map((k) => k.publicKey);
type Tab = (typeof ALL_TABS)[number];
const ALL_SITES = { origins: ['*://*/*'] };

function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function App() {
  const store = useStore('settings', 'stats', 'managed', 'managedRemote', 'ruleset', 'feed', 'lists', 'pro');
  const [tab, setTab] = useState<Tab>('General');
  const [hasAllSites, setHasAllSites] = useState(false);
  useEffect(() => void browser.permissions.contains(ALL_SITES).then(setHasAllSites), []);

  if (!store || !store.ruleset) return null;
  const { settings, ruleset } = store;
  const managed = mergeManaged(store.managed, store.managedRemote);
  const locked = isLocked(managed);
  const eff = effectiveSettings(settings, managed);
  const save = (fn: (s: Settings) => Settings) => (locked ? Promise.resolve(settings) : updateSettings(fn));

  const toggleAllSites = async () => {
    if (hasAllSites) await browser.permissions.remove(ALL_SITES);
    else await browser.permissions.request(ALL_SITES);
    setHasAllSites(await browser.permissions.contains(ALL_SITES));
    void browser.runtime.sendMessage({ type: 'allSitesChanged' });
  };

  return (
    <div className="opt">
      <h1>AI OFF</h1>
      <p className="opt__sub">One switch. No AI inside. Nothing leaves this device.</p>
      {managed && (
        <div className="banner" role="status">
          Managed by <strong>{managed.orgName ?? 'your organization'}</strong>. {locked ? 'Settings are locked. ' : ''}
          Effective policy: level {eff.level}
          {managed.examMode?.enabled ? ', exam mode on' : ''}
          {managed.allowSites?.length ? `, allowed sites: ${managed.allowSites.join(', ')}` : ''}
          {managed.configUrl ? ', hosted config in use' : ', static policy (no extra network calls)'}.
        </div>
      )}
      <div className="opt__tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'General' && (
        <>
          <div className="card" style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            <Switch size="md" aiOff={eff.enabled} locked={locked} sound={settings.sound} onChange={(v) => save((s) => ({ ...s, enabled: v, pauseUntil: null }))} />
            <div style={{ flex: 1, minWidth: 260 }}>
              <Dial level={eff.level} locked={locked} disabled={!eff.enabled} onChange={(level: Level) => save((s) => ({ ...s, level }))} />
            </div>
          </div>
          <h2>What each level does</h2>
          {LEVELS.map((l) => (
            <p key={l.level} className="hint">
              <strong>
                Level {l.level}: {l.name}.
              </strong>{' '}
              {l.detail}
            </p>
          ))}
          <h2>Reach</h2>
          <div className="card">
            <label className="check">
              <input type="checkbox" checked={hasAllSites} onChange={toggleAllSites} />
              <span>
                <strong>Work on all sites.</strong> Needed for generic rules ("Ask AI" buttons, AI chat widgets), for muting on news sites, and for
                Level 3 everywhere. Without it AI Off only touches the sites in its built-in list. The browser will ask you to confirm.
              </span>
            </label>
          </div>
          <h2>Level 3 behavior</h2>
          <div className="card">
            <label className="check">
              <input type="radio" name="prov" checked={settings.provenanceMode === 'hide'} disabled={locked} onChange={() => save((s) => ({ ...s, provenanceMode: 'hide' }))} />
              <span>Hide images that declare they are AI generated</span>
            </label>
            <label className="check">
              <input type="radio" name="prov" checked={settings.provenanceMode === 'badge'} disabled={locked} onChange={() => save((s) => ({ ...s, provenanceMode: 'badge' }))} />
              <span>Keep them visible and mark them with a red outline (badge mode)</span>
            </label>
            <p className="hint">
              AI Off never guesses. It only reads what a file or a platform declares about itself (Content Credentials, IPTC metadata, platform
              labels). Most AI images carry no declaration, and most social sites strip metadata, so expect this to catch a minority.
            </p>
          </div>
          <h2>Sound</h2>
          <label className="check">
            <input type="checkbox" checked={settings.sound} onChange={(e) => updateSettings((s) => ({ ...s, sound: e.currentTarget.checked }))} />
            <span>Play a click when the switch flips</span>
          </label>
        </>
      )}

      {tab === 'Rules' && <RulesTab ruleset={ruleset} settings={settings} locked={locked} save={save} />}

      {tab === 'Words' && (
        <WordsTab ruleset={ruleset} settings={settings} locked={locked} save={save} />
      )}

      {tab === 'Sites' && (
        <>
          <h2>Paused sites</h2>
          <p className="hint">AI Off does nothing on these sites. Add one from the popup with "Pause on this site".</p>
          <ChipList
            items={settings.pausedSites}
            empty="No paused sites."
            onRemove={(h) => save((s) => ({ ...s, pausedSites: s.pausedSites.filter((x) => x !== h) }))}
          />
          <h2>Support chat shown again</h2>
          <p className="hint">AI Off hides AI chat widgets. List a site here to show its chat widget anyway.</p>
          <AddLine placeholder="example.com" disabled={locked} onAdd={(h) => save((s) => ({ ...s, showSupportChat: [...new Set([...s.showSupportChat, h.toLowerCase()])] }))} />
          <ChipList
            items={settings.showSupportChat}
            empty="None."
            onRemove={(h) => save((s) => ({ ...s, showSupportChat: s.showSupportChat.filter((x) => x !== h) }))}
          />
          <h2>Your own rules</h2>
          <p className="hint">Made with the element picker. Stored only on this device.</p>
          {settings.userRules.length === 0 && <p className="hint">None yet.</p>}
          {settings.userRules.map((r) => (
            <div key={r.host + r.selector} className="inline" style={{ marginBottom: 6 }}>
              <code style={{ flex: 1, overflowWrap: 'anywhere' }}>
                {r.host} ## {r.selector}
              </code>
              <button className="btn" onClick={() => save((s) => ({ ...s, userRules: s.userRules.filter((x) => x !== r && !(x.host === r.host && x.selector === r.selector)) }))}>
                Remove
              </button>
            </div>
          ))}
        </>
      )}

      {tab === 'Stats' && (
        <>
          <div className="grid3">
            <div className="card">
              <div className="big">{totalSince(store.stats, 1).toLocaleString()}</div>today
            </div>
            <div className="card">
              <div className="big">{totalSince(store.stats, 7).toLocaleString()}</div>this week
            </div>
            <div className="card">
              <div className="big">{totalSince(store.stats, 90).toLocaleString()}</div>last 90 days
            </div>
          </div>
          <h2>By site, last 7 days</h2>
          <StatsBars rows={bySite(store.stats, 7)} ruleset={ruleset} />
          <p className="hint">
            Stats are daily counters by site and rule. No URLs, no page content, and they never leave this device.{' '}
            <button className="btn" onClick={() => setStore({ stats: { days: {} } })}>
              Clear stats
            </button>
          </p>
        </>
      )}

      {tab === 'Email' && <EmailTab ruleset={ruleset} settings={settings} />}

      {!SAFARI && tab === 'Pro' && <ProTab pro={store.pro} />}

      {tab === 'Backup' && (
        <>
          <h2>Export and import settings</h2>
          <p className="hint">A plain JSON file. Stats are not included.</p>
          <div className="inline">
            <button className="btn" onClick={() => download('aioff-settings.json', JSON.stringify(settings, null, 2))}>
              Export settings
            </button>
            <label className="btn" style={{ cursor: locked ? 'not-allowed' : 'pointer' }}>
              Import settings
              <input
                type="file"
                accept="application/json"
                hidden
                disabled={locked}
                onChange={async (e) => {
                  const file = e.currentTarget.files?.[0];
                  if (!file) return;
                  try {
                    // Field by field: a wrong or missing field takes its default, nothing else is read from the file.
                    const clean = sanitizeSettings(JSON.parse(await file.text()));
                    await save(() => clean);
                  } catch {
                    alert('That file is not a valid AI Off settings export.');
                  }
                }}
              />
            </label>
          </div>
        </>
      )}

      {tab === 'About' && (
        <>
          <h2>Rules feed</h2>
          <div className="card">
            <p>
              Version <code>{store.feed?.version ?? ruleset.version}</code> ({store.feed?.source ?? 'embedded'}). Last checked:{' '}
              {store.feed?.checkedAt ? new Date(store.feed.checkedAt).toLocaleString() : 'not yet'}.
              {store.feed?.lastError ? ` Last error: ${store.feed.lastError}. The last good rules stay in use.` : ''}
            </p>
            <button className="btn" onClick={() => browser.runtime.sendMessage({ type: 'checkFeedNow' })}>
              Check now
            </button>
          </div>
          <h2>Every network call AI Off makes</h2>
          <div className="card">
            <p>
              1. The signed rules feed, every 6 hours: <code>{FEED_URL}</code> (verified with Ed25519 before use).
            </p>
            <p>
              2. At Level 3 and above only: the community blocklists named in the rules feed ({ruleset.provenance.domainLists.length + ruleset.provenance.youtubeChannelLists.length} lists), once a day, and a re-read of images
              already on the page to check their declared provenance.
            </p>
            <p>3. On managed devices only, and only if the administrator set one: the organization config URL, every 15 minutes.</p>
            {!SAFARI && (
              <p>4. Only if you turn on Pro sync: your settings, encrypted on this device with a key made from your passphrase, sent to <code>sync.aioff.app</code>. The server stores bytes it cannot read.</p>
            )}
            <p>That is all. No analytics, no crash reports, no account. AI Off contains no AI: every decision is a rule you can read on the Rules tab.</p>
          </div>
          <p className="hint">
            Version {browser.runtime.getManifest().version}. MIT licensed. <a href={SITE_URL}>{SITE_URL.replace('https://', '')}</a>
          </p>
        </>
      )}
    </div>
  );
}

function ChipList({ items, empty, onRemove }: { items: string[]; empty: string; onRemove: (item: string) => void }) {
  if (!items.length) return <p className="hint">{empty}</p>;
  return (
    <div className="chips">
      {items.map((i) => (
        <span className="chip" key={i}>
          {i}
          <button aria-label={`Remove ${i}`} onClick={() => onRemove(i)}>
            x
          </button>
        </span>
      ))}
    </div>
  );
}

function AddLine({ placeholder, onAdd, disabled }: { placeholder: string; onAdd: (v: string) => void; disabled?: boolean }) {
  const [v, setV] = useState('');
  const add = () => {
    const t = v.trim();
    if (t) onAdd(t);
    setV('');
  };
  return (
    <div className="inline" style={{ marginBottom: 10 }}>
      <input type="text" value={v} placeholder={placeholder} disabled={disabled} onChange={(e) => setV(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
      <button className="btn" disabled={disabled} onClick={add}>
        Add
      </button>
    </div>
  );
}

type SaveFn = (fn: (s: Settings) => Settings) => Promise<Settings>;

function RulesTab({ ruleset, settings, locked, save }: { ruleset: Ruleset; settings: Settings; locked: boolean; save: SaveFn }) {
  const [asText, setAsText] = useState(false);
  const text = useMemo(() => {
    const lines: string[] = [`! AI Off rules ${ruleset.version}`];
    for (const site of ruleset.sites) {
      lines.push('', `! ${site.name} (${site.match.join(', ')})`);
      for (const r of site.rules) {
        const lvl = `L${r.level ?? site.level}`;
        if (r.kind === 'hide' || r.kind === 'remove') {
          for (const sel of (r as HideRule).selectors) lines.push(`${site.id}##${sel}    ! ${r.id} ${lvl}`);
          for (const a of (r as HideRule).textAnchors ?? []) lines.push(`${site.id}#?#text-starts-with(${a})    ! ${r.id} ${lvl}`);
        } else lines.push(`${site.id}  ${r.kind}  ${JSON.stringify({ ...r, id: undefined, description: undefined, kind: undefined })}    ! ${r.id} ${lvl}`);
      }
    }
    for (const n of ruleset.network) lines.push('', `! ${n.description} (L${n.level})`, ...n.domains.map((d) => `||${d}^`));
    return lines.join('\n');
  }, [ruleset]);

  const isOn = (id: string, defaultEnabled?: boolean) =>
    defaultEnabled === false ? settings.enabledOptionalRules.includes(id) : !settings.disabledRules.includes(id);
  const toggle = (id: string, defaultEnabled: boolean | undefined, on: boolean) =>
    save((s) =>
      defaultEnabled === false
        ? { ...s, enabledOptionalRules: on ? [...new Set([...s.enabledOptionalRules, id])] : s.enabledOptionalRules.filter((x) => x !== id) }
        : { ...s, disabledRules: on ? s.disabledRules.filter((x) => x !== id) : [...new Set([...s.disabledRules, id])] },
    );

  return (
    <>
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <p className="hint">
          {ruleset.sites.length} sites, {ruleset.sites.reduce((n, s) => n + s.rules.length, 0)} rules. Every rule is data you can read. Untick one to
          turn it off.
        </p>
        <button className="btn" onClick={() => setAsText(!asText)}>
          {asText ? 'View as list' : 'View rules as text'}
        </button>
      </div>
      {asText ? (
        <textarea readOnly value={text} aria-label="Rules as text" />
      ) : (
        ruleset.sites.map((site) => (
          <details className="site" key={site.id}>
            <summary>
              {site.name} <span className="hint">({site.rules.length})</span>
            </summary>
            {site.rules.map((r) => (
              <RuleExplainer
                key={r.id}
                ruleId={r.id}
                description={r.description + (r.defaultEnabled === false ? ' (off unless you turn it on)' : '')}
                siteName={site.name}
                level={r.level ?? site.level}
                selectors={(r as HideRule).selectors}
                textAnchors={(r as HideRule).textAnchors}
                enabled={isOn(r.id, r.defaultEnabled)}
                locked={locked}
                onToggle={(on) => toggle(r.id, r.defaultEnabled, on)}
              />
            ))}
          </details>
        ))
      )}
    </>
  );
}

function WordsTab({ ruleset, settings, locked, save }: { ruleset: Ruleset; settings: Settings; locked: boolean; save: SaveFn }) {
  const off = new Set(settings.disabledFeedTerms.map((t) => t.toLowerCase()));
  return (
    <>
      <h2>Your words</h2>
      <p className="hint">Level 2 collapses posts and headlines that contain these. Whole words only. Short all-caps words match case exactly.</p>
      <AddLine placeholder="Add a word or phrase" disabled={locked} onAdd={(t) => save((s) => ({ ...s, userMuteTerms: [...new Set([...s.userMuteTerms, t])] }))} />
      <ChipList items={settings.userMuteTerms} empty="No words of your own yet." onRemove={(t) => save((s) => ({ ...s, userMuteTerms: s.userMuteTerms.filter((x) => x !== t) }))} />
      <h2>AI Off wordlist ({ruleset.mute.terms.length})</h2>
      <p className="hint">Click a word to stop muting it.</p>
      <div className="chips">
        {ruleset.mute.terms.map((t) => {
          const disabled = off.has(t.toLowerCase());
          return (
            <button
              key={t}
              className={`chip ${disabled ? 'is-off' : ''}`}
              disabled={locked}
              aria-pressed={!disabled}
              onClick={() =>
                save((s) => ({
                  ...s,
                  disabledFeedTerms: disabled ? s.disabledFeedTerms.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...s.disabledFeedTerms, t],
                }))
              }
            >
              {t}
            </button>
          );
        })}
      </div>
    </>
  );
}

function StatsBars({ rows, ruleset }: { rows: { siteId: string; total: number }[]; ruleset: Ruleset }) {
  if (!rows.length) return <p className="hint">Nothing hidden yet.</p>;
  const names: Record<string, string> = { mute: 'Muted posts and headlines', ads: 'AI ads', provenance: 'AI-made content', user: 'Your own rules' };
  for (const s of ruleset.sites) names[s.id] = s.name;
  const max = Math.max(...rows.map((r) => r.total));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.siteId} style={{ display: 'contents' }}>
          <span>{names[r.siteId] ?? r.siteId}</span>
          <span className="bar" style={{ width: `${(r.total / max) * 100}%` }} />
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.total.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function EmailTab({ ruleset, settings }: { ruleset: Ruleset; settings: Settings }) {
  const terms = useMemo(() => {
    const off = new Set(settings.disabledFeedTerms.map((t) => t.toLowerCase()));
    return [...ruleset.mute.terms.filter((t) => !off.has(t.toLowerCase())), ...settings.userMuteTerms];
  }, [ruleset, settings]);
  return (
    <>
      <h2>Gmail</h2>
      <div className="card">
        <p>
          AI Off builds a filter file on this device. You import it in Gmail, review each filter, and Gmail does the rest. Newsletters and marketing
          mail with AI subject lines skip the inbox and land under the label "AI Off". AI Off never reads your mail and never signs in to anything.
        </p>
        <div className="inline">
          <button className="btn primary" onClick={() => download('aioff-gmail-filters.xml', gmailFiltersXml(terms), 'application/xml')}>
            1. Download the filter file
          </button>
          <a className="btn" style={{ textDecoration: 'none' }} href="https://mail.google.com/mail/u/0/#settings/filters" target="_blank" rel="noreferrer">
            2. Open Gmail filter settings
          </a>
        </div>
        <p className="hint">3. At the bottom of that page choose "Import filters", pick the file, tick the filters you want, then "Create filters".</p>
      </div>
      <h2>Outlook on the web</h2>
      <div className="card">
        <p>Outlook cannot import filters, so this one is a short manual rule:</p>
        <p className="hint">
          Settings, Mail, Rules, Add new rule. Condition: "Subject includes". Paste the words below. Action: "Move to" a folder named AI Off. Save.
        </p>
        <textarea readOnly style={{ minHeight: 90 }} value={outlookRuleText(terms)} aria-label="Words for the Outlook rule" />
        <a className="btn" style={{ textDecoration: 'none' }} href="https://outlook.live.com/mail/0/options/mail/rules" target="_blank" rel="noreferrer">
          Open Outlook rules
        </a>
      </div>
    </>
  );
}

function ProTab({ pro }: { pro: ProState }) {
  const [key, setKey] = useState(pro.license ?? '');
  const [check, setCheck] = useState<LicenseResult | null>(null);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!key.trim()) return setCheck(null);
    void verifyLicense(key, PUBLIC_KEYS).then(setCheck);
  }, [key]);
  const valid = !!check?.valid && !check.expired;

  const saveKey = async () => {
    await setStore({ pro: { ...pro, license: valid ? key.trim() : null } });
    setMsg(valid ? 'Key saved. It is checked on this device only.' : 'Key removed.');
  };
  const turnOn = async () => {
    if (pass.length < 8) return setMsg('Use a passphrase of at least 8 characters. Longer is better; a sentence is best.');
    setBusy(true);
    try {
      const keys = await deriveSyncKeys(pass);
      await setStore({ pro: { ...pro, license: key.trim(), sync: { ...pro.sync, enabled: true, blobId: keys.blobId, keyB64: bytesToBase64(keys.keyBytes), lastError: null } } });
      const pulled = (await browser.runtime.sendMessage({ type: 'syncNow', direction: 'pull' })) as { ok: boolean; action?: string; error?: string };
      if (pulled.ok && pulled.action === 'nothing-remote') {
        const pushed = (await browser.runtime.sendMessage({ type: 'syncNow', direction: 'push' })) as { ok: boolean; error?: string };
        setMsg(pushed.ok ? 'Sync is on. This device uploaded its settings.' : `Sync is on, but the first upload failed: ${pushed.error}`);
      } else if (pulled.ok) setMsg(pulled.action === 'pulled' ? 'Sync is on. Settings from your other device were applied.' : 'Sync is on and up to date.');
      else setMsg(`Sync is on, but the first download failed: ${pulled.error}`);
      setPass('');
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    await setStore({ pro: { ...pro, sync: { ...DEFAULT_PRO.sync } } });
    setMsg('Sync is off. The key made from your passphrase was erased from this device. The encrypted copy on the server stays until you delete it from a device that still has the passphrase, or it is simply never read again.');
  };
  const now = async (direction: 'push' | 'pull') => {
    setBusy(true);
    const r = (await browser.runtime.sendMessage({ type: 'syncNow', direction })) as { ok: boolean; action?: string; error?: string };
    setBusy(false);
    setMsg(r.ok ? `Done: ${r.action}.` : `Failed: ${r.error}`);
  };

  return (
    <>
      <h2>Pro license</h2>
      <div className="card">
        <p className="hint">
          Pro covers the desktop companion and encrypted sync, and funds the nightly rule checks. Keys are verified on this device.
          No account, no login. <a href="https://aioff.app/pricing/" target="_blank" rel="noreferrer">Get a key</a>.
        </p>
        <input type="text" value={key} placeholder="AIOFF-..." spellCheck={false} onChange={(e) => setKey(e.currentTarget.value)} />
        {check && !check.valid && <p className="hint">That key is not valid ({check.reason}).</p>}
        {check?.valid && (
          <p className="hint">
            {check.payload.plan} plan, {check.payload.devices} devices{check.payload.expires ? `, ${check.expired ? 'expired' : 'valid until'} ${check.payload.expires}` : ', lifetime'}.
          </p>
        )}
        <button className="btn" onClick={saveKey} disabled={!!key.trim() && !valid}>
          {key.trim() ? 'Save key' : 'Remove key'}
        </button>
      </div>

      <h2>Encrypted sync</h2>
      <div className="card">
        <p className="hint">
          Your settings (level, paused sites, your words, your rules) travel between your devices encrypted with a key made from a passphrase you
          choose. The server stores bytes it cannot read, under an id it cannot link to you. There is no password reset: lose the passphrase and
          the copy on the server is unreadable, which is the point.
        </p>
        {!pro.sync.enabled ? (
          <>
            <input type="text" value={pass} placeholder="A passphrase. A sentence works well." disabled={!valid || busy} onChange={(e) => setPass(e.currentTarget.value)} />
            <p className="hint">Use the same passphrase on every device you want in sync.</p>
            <button className="btn primary" onClick={turnOn} disabled={!valid || busy}>
              {busy ? 'Working...' : 'Turn on sync'}
            </button>
            {!valid && <p className="hint">Save a valid Pro key first.</p>}
          </>
        ) : (
          <>
            <p className="hint">
              Sync is on. Last upload: {pro.sync.lastPush ? new Date(pro.sync.lastPush).toLocaleString() : 'never'}. Last download:{' '}
              {pro.sync.lastPull ? new Date(pro.sync.lastPull).toLocaleString() : 'never'}.{pro.sync.lastError ? ` Last error: ${pro.sync.lastError}` : ''}
            </p>
            <div className="inline">
              <button className="btn" disabled={busy} onClick={() => now('push')}>Upload now</button>
              <button className="btn" disabled={busy} onClick={() => now('pull')}>Download now</button>
              <button className="btn" disabled={busy} onClick={turnOff}>Turn off sync</button>
            </div>
          </>
        )}
        {msg && <p className="hint">{msg}</p>}
      </div>
    </>
  );
}
