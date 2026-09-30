import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { verifyLicense, type LicenseResult } from '@aioff/core';
import { checklist, macMobileconfig, windowsCommands, type BrowserId } from '@aioff/policies';
import publicKeys from '@aioff/rules/public-keys';
import { Switch } from '@aioff/ui';
import { buildPlan, type Platform, type PlanItem } from './plan';

interface HostInfo { platform: Platform; os_version: string; browsers: BrowserId[] }
interface ActionReport { id: string; ok: boolean; applied: boolean; detail: string }

const KEYS = (publicKeys as { keys: { publicKey: string }[] }).keys.map((k) => k.publicKey);
const load = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '') as T;
  } catch {
    return d;
  }
};

export function App() {
  const [host, setHost] = useState<HostInfo | null>(null);
  const [reports, setReports] = useState<Record<string, ActionReport>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>(() => load('checklist', {}));
  const [licenseKey, setLicenseKey] = useState(() => localStorage.getItem('license') ?? '');
  const [license, setLicense] = useState<LicenseResult | null>(null);
  const [lastOs, setLastOs] = useState(() => localStorage.getItem('os') ?? '');
  // The physical switch: any keyboard-emulating macropad works. Default chord, editable below.
  const [hotkey, setHotkey] = useState(() => localStorage.getItem('hotkey') ?? 'CommandOrControl+Shift+O');
  const [hotkeyState, setHotkeyState] = useState('');

  const plan: PlanItem[] = useMemo(() => (host ? buildPlan(host.platform, host.browsers) : []), [host]);
  const actions = useMemo(() => plan.flatMap((p) => p.actions), [plan]);

  const verify = async () => {
    const res = await invoke<ActionReport[]>('verify', { actions });
    setReports(Object.fromEntries(res.map((r) => [r.id, r])));
  };

  useEffect(() => void invoke<HostInfo>('host_info').then(setHost), []);
  useEffect(() => void (actions.length && verify()), [actions.length]);
  useEffect(() => void (licenseKey ? verifyLicense(licenseKey, KEYS).then(setLicense) : setLicense(null)), [licenseKey]);

  useEffect(() => {
    let alive = true;
    void unregisterAll()
      .then(() => register(hotkey, (e) => e.state === 'Pressed' && document.querySelector<HTMLButtonElement>('.aioff-switch')?.click()))
      .then(() => alive && setHotkeyState('active'))
      .catch((e) => alive && setHotkeyState(`could not register: ${String(e)}`));
    return () => {
      alive = false;
    };
  }, [hotkey]);

  if (!host) return null;
  const appliedCount = plan.filter((p) => reports[p.id]?.applied).length;
  const allApplied = plan.length > 0 && appliedCount === plan.length;
  const osChanged = !!lastOs && lastOs !== host.os_version;
  const pro = !!license?.valid && !license.expired;

  const run = async (cmd: 'apply' | 'revert') => {
    setBusy(true);
    try {
      await invoke(cmd, { actions });
      localStorage.setItem('os', host.os_version);
      setLastOs(host.os_version);
      await verify();
    } finally {
      setBusy(false);
    }
  };

  const items = checklist().filter((c) => {
    const p = c.platform.toLowerCase();
    if (host.platform === 'macos') return p.includes('mac') || p.includes('web') || p.includes('desktop');
    if (host.platform === 'windows') return p.includes('windows') || p.includes('web') || p.includes('desktop');
    return p.includes('web');
  });

  return (
    <div className="app">
      <h1>AI OFF</h1>
      <div className="top">
        <Switch size="md" aiOff={allApplied} locked={busy || !pro} onChange={(off) => run(off ? 'apply' : 'revert')} />
        <div style={{ flex: 1, minWidth: 260 }}>
          <strong>{allApplied ? 'AI is off on this computer.' : `${appliedCount} of ${plan.length} settings are off.`}</strong>
          <p className="note">
            {host.platform} {host.os_version}. Found: {host.browsers.join(', ') || 'no supported browsers'}.
            {osChanged ? ' Your system updated since the last check. Updates sometimes turn AI back on, so AI Off re-checked everything below.' : ''}
          </p>
          <button className="btn" disabled={busy} onClick={verify}>Check again</button>{' '}
          {!allApplied && appliedCount > 0 && <button className="btn primary" disabled={busy || !pro} onClick={() => run('apply')}>Re-apply</button>}
        </div>
      </div>

      {!pro && (
        <div className="card">
          <strong>Pro license</strong>
          <p className="note">The companion is the paid part of AI Off. Keys are checked on this device. There is no account.</p>
          <input className="key" placeholder="AIOFF-..." value={licenseKey} onChange={(e) => { setLicenseKey(e.currentTarget.value); localStorage.setItem('license', e.currentTarget.value); }} />
          {license && !license.valid && <p className="note">That key is not valid ({license.reason}).</p>}
          {license?.valid && license.expired && <p className="note">That key expired on {license.payload.expires}. Everything already applied stays applied.</p>}
        </div>
      )}

      <h2>What the switch changes</h2>
      <p className="note">Asking for your password happens once per flip, and only for the items marked "admin". Every change is journaled so turning AI back on restores the exact previous values.</p>
      {plan.map((p) => {
        const r = reports[p.id];
        return (
          <div className="card" key={p.id}>
            <div className="row">
              <div><strong>{p.title}</strong><p>{p.explain}</p></div>
              <div style={{ display: 'flex', gap: 6 }}>
                {p.needsAdmin && <span className="tag">admin</span>}
                <span className={`tag ${r?.applied ? 'ok' : 'bad'}`}>{r ? (r.applied ? 'off' : 'not applied') : '...'}</span>
              </div>
            </div>
          </div>
        );
      })}

      {host.platform === 'macos' && (
        <>
          <h2>Apple Intelligence</h2>
          <div className="card">
            <p className="note">Apple offers no supported way for an app to flip these. AI Off builds a configuration profile (Writing Tools, Image Playground, Genmoji, Mail and Safari summaries, the ChatGPT extension). You approve it in System Settings, and you can remove it there any time.</p>
            <button className="btn" onClick={() => invoke('open_profile', { content: macMobileconfig({ browsers: [], appleIntelligence: true, identifier: 'app.aioff.appleintelligence' }) })}>
              Create and open the profile
            </button>{' '}
            <button className="btn" onClick={() => invoke('open_url', { url: 'x-apple.systempreferences:com.apple.Profiles-Settings.extension' })}>Open Device Management</button>
          </div>
        </>
      )}
      {host.platform === 'windows' && (
        <>
          <h2>One-time actions</h2>
          {windowsCommands().map((c) => (
            <div className="card" key={c.id}>
              <div className="row">
                <div><strong>{c.title}</strong><p><code>{c.command}</code></p></div>
                <button className="btn" onClick={() => invoke('run_windows_command', { id: c.id, shell: c.shell, command: c.command, needsAdmin: c.needsAdmin })}>Run</button>
              </div>
            </div>
          ))}
        </>
      )}

      <h2>Physical switch</h2>
      <div className="card">
        <p className="note">
          A global hotkey flips the switch from anywhere, even when this window is hidden. Plug in a one-key macropad, program it to this chord, and you have a
          real off switch on your desk.
        </p>
        <input className="key" value={hotkey} onChange={(e) => { setHotkey(e.currentTarget.value); localStorage.setItem('hotkey', e.currentTarget.value); }} />
        <p className="note">{hotkeyState}</p>
      </div>

      <h2>Apps only you can switch off ({items.filter((i) => done[i.id]).length} of {items.length} done)</h2>
      <p className="note">AI Off cannot flip these for you. Here is the exact switch for each.</p>
      {items.map((c) => (
        <details className="card" key={c.id}>
          <summary>
            <input type="checkbox" checked={!!done[c.id]} onClick={(e) => e.stopPropagation()} onChange={(e) => { const next = { ...done, [c.id]: e.currentTarget.checked }; setDone(next); localStorage.setItem('checklist', JSON.stringify(next)); }} />{' '}
            <strong>{c.app}</strong> <span className="tag">{c.platform}</span>{' '}
            <span className={`tag ${c.canDisable === 'yes' ? 'ok' : 'bad'}`}>{c.canDisable === 'yes' ? 'can be turned off' : c.canDisable === 'partial' ? 'partly' : 'cannot be turned off'}</span>
          </summary>
          <ol className="steps">{c.steps.map((s) => <li key={s}>{s}</li>)}</ol>
          {c.notes && <p className="note">{c.notes}</p>}
          <p className="note">
            Last verified {c.lastVerified}. {c.url && <button className="btn" onClick={() => invoke('open_url', { url: c.url })}>Open the setting</button>}{' '}
            <button className="btn" onClick={() => invoke('open_url', { url: `https://github.com/joecool1493/aioff/issues/new?labels=checklist&title=${encodeURIComponent('Checklist changed: ' + c.app)}` })}>This changed</button>
          </p>
        </details>
      ))}
    </div>
  );
}
