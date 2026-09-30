// Policy catalog and generators. Everything here is data plus pure string builders,
// so the desktop companion (Rust) stays a thin executor and all logic is unit tested.

import browsersJson from './browsers.json' with { type: 'json' };
import checklistsJson from './checklists.json' with { type: 'json' };
import macosJson from './macos.json' with { type: 'json' };
import windowsJson from './windows.json' with { type: 'json' };

export type PolicyValue = boolean | number | string | string[];
export type BrowserId = 'chrome' | 'chromium' | 'edge' | 'brave' | 'firefox';

export interface ChromiumBrowser {
  name: string;
  policies: Record<string, PolicyValue>;
  legacyPolicies?: Record<string, PolicyValue>;
  chromeOsPolicies?: Record<string, PolicyValue>;
  windowsKey: string;
  macDomain: string;
  linuxDir: string;
  macApp: string;
  caveat?: string;
}
export interface FirefoxBrowser {
  name: string;
  policiesJson: { policies: Record<string, unknown> };
  windowsKey: string;
  macDomain: string;
  linuxFile: string;
  macApp: string;
  caveat?: string;
}

export interface WindowsTweak {
  id: string;
  title: string;
  hive: 'HKLM' | 'HKCU';
  path: string;
  name: string;
  type: 'REG_DWORD' | 'REG_SZ';
  value: number | string;
  needsAdmin: boolean;
  verified: boolean;
  source: string;
  notes?: string;
}

export interface MacRestrictionKey {
  key: string;
  payloadType: string;
  type: string;
  valueToDisable: boolean;
  minOS: string;
  requiresSupervision: boolean;
  allowManualInstall: boolean;
  deprecatedIn?: string;
  verified: boolean;
  source: string;
}

export interface ChecklistItem {
  id: string;
  app: string;
  platform: string;
  steps: string[];
  url: string | null;
  whoCanChange: string;
  canDisable: 'yes' | 'partial' | 'no';
  canDisableNote?: string;
  lastVerified: string;
  source: string;
  notes?: string;
  /** True only when the research note is marked VERIFIED. Unmarked entries count as not verified. */
  verified: boolean;
  /** notes with the VERIFIED / UNVERIFIED prefix removed, for display. */
  displayNotes: string;
}

const browsers = browsersJson as unknown as Record<BrowserId, ChromiumBrowser | FirefoxBrowser>;
export const CHROMIUM_IDS: BrowserId[] = ['chrome', 'chromium', 'edge', 'brave'];
export const chromium = (id: BrowserId) => browsers[id] as ChromiumBrowser;
export const firefox = () => browsers.firefox as FirefoxBrowser;
export const browserName = (id: BrowserId) => browsers[id].name;

/** Tweaks that are safe to apply by default: verified in vendor docs, and not the nuclear "disable search" option. */
const WINDOWS_OPT_IN = new Set(['search-ui-disable', 'office-all-connected-off', 'copilot-legacy-policy', 'search-no-web-results']);
export const windowsTweaks = (): WindowsTweak[] => (windowsJson as unknown as { tweaks: WindowsTweak[] }).tweaks;
export const defaultWindowsTweaks = (): WindowsTweak[] =>
  windowsTweaks().filter((t) => t.verified && !WINDOWS_OPT_IN.has(t.id) && !String(t.value).startsWith('<'));
export const windowsCommands = () =>
  (windowsJson as unknown as { commands: { id: string; title: string; shell: string; command: string; needsAdmin: boolean; verified: boolean; source: string }[] }).commands;

export const macRestrictionKeys = (): MacRestrictionKey[] => (macosJson as unknown as { restrictionKeys: MacRestrictionKey[] }).restrictionKeys;
/** Keys that work in a manually installed profile on an unsupervised Mac. */
export const manualMacKeys = (): MacRestrictionKey[] =>
  macRestrictionKeys().filter((k) => k.verified && k.allowManualInstall && !k.requiresSupervision && k.type === 'boolean');

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
export function checklist(): ChecklistItem[] {
  const raw = (checklistsJson as unknown as { items: (Omit<ChecklistItem, 'id' | 'canDisable'> & { canDisable: unknown })[] }).items;
  const seen = new Set<string>();
  return raw.map((item) => {
    const cd = item.canDisable;
    const canDisable: ChecklistItem['canDisable'] = cd === true || /^yes/i.test(String(cd)) ? 'yes' : cd === false ? 'no' : 'partial';
    let id = slug(`${item.app}-${item.platform}`);
    while (seen.has(id)) id += '-2';
    seen.add(id);
    const notes = String(item.notes ?? '');
    const verified = /^VERIFIED\b/.test(notes);
    const displayNotes = notes.replace(/^(VERIFIED|UNVERIFIED)\.?\s*/, '');
    // A bare "partial" / "yes" / "no" string carries no information; only a longer note is a limitation worth showing.
    const canDisableNote = typeof cd === 'string' && !/^(yes|no|partial|true|false)$/i.test(cd.trim()) ? cd : undefined;
    return { ...item, id, canDisable, canDisableNote, verified, displayNotes };
  });
}

// ---------------------------------------------------------------- Windows .reg

function regValue(v: PolicyValue): string {
  if (typeof v === 'boolean') return `dword:${v ? '00000001' : '00000000'}`;
  if (typeof v === 'number') return `dword:${(v >>> 0).toString(16).padStart(8, '0')}`;
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export interface RegOptions {
  browsers: BrowserId[];
  tweaks?: WindowsTweak[];
  includeLegacy?: boolean;
  hive?: 'HKLM' | 'HKCU';
}

function chromiumRegEntries(id: BrowserId, includeLegacy: boolean): [string, PolicyValue][] {
  const b = chromium(id);
  return Object.entries({ ...b.policies, ...(includeLegacy ? b.legacyPolicies : {}) });
}

/** Flatten Firefox policies.json into registry keys, the way Firefox's GPO templates lay them out. */
function firefoxRegLines(root: string): string[] {
  const out: string[] = [];
  const walk = (key: string, obj: Record<string, unknown>) => {
    const scalars = Object.entries(obj).filter(([, v]) => typeof v !== 'object' || v === null);
    if (scalars.length) {
      out.push('', `[${key}]`);
      for (const [name, v] of scalars) out.push(`"${name}"=${regValue(v as PolicyValue)}`);
    }
    for (const [name, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // The Preferences policy is a single JSON string value in the registry.
        if (name === 'Preferences') {
          out.push('', `[${key}]`, `"Preferences"=${regValue(JSON.stringify(v))}`);
        } else walk(`${key}\\${name}`, v as Record<string, unknown>);
      }
    }
  };
  walk(root, firefox().policiesJson.policies);
  return out;
}

export function windowsReg(opts: RegOptions): string {
  const hive = opts.hive === 'HKCU' ? 'HKEY_CURRENT_USER' : 'HKEY_LOCAL_MACHINE';
  const lines = ['Windows Registry Editor Version 5.00', '', '; AI Off: turn AI off. Generated file. Revert with the matching aioff-revert.reg.'];
  for (const id of opts.browsers) {
    if (id === 'firefox') {
      lines.push('', `; ${firefox().name}`, ...firefoxRegLines(`${hive}\\${firefox().windowsKey}`));
      continue;
    }
    lines.push('', `; ${chromium(id).name}`, `[${hive}\\${chromium(id).windowsKey}]`);
    for (const [name, v] of chromiumRegEntries(id, !!opts.includeLegacy)) {
      if (Array.isArray(v)) continue; // list policies are subkeys; written below
      lines.push(`"${name}"=${regValue(v)}`);
    }
    for (const [name, v] of chromiumRegEntries(id, !!opts.includeLegacy)) {
      if (!Array.isArray(v)) continue;
      lines.push('', `[${hive}\\${chromium(id).windowsKey}\\${name}]`, ...v.map((item, i) => `"${i + 1}"=${regValue(item)}`));
    }
  }
  const byKey = new Map<string, WindowsTweak[]>();
  for (const t of opts.tweaks ?? []) {
    const key = `${t.hive === 'HKLM' ? 'HKEY_LOCAL_MACHINE' : 'HKEY_CURRENT_USER'}\\${t.path}`;
    byKey.set(key, [...(byKey.get(key) ?? []), t]);
  }
  for (const [key, tweaks] of byKey) {
    lines.push('', ...tweaks.map((t) => `; ${t.title}`), `[${key}]`, ...tweaks.map((t) => `"${t.name}"=${regValue(t.value)}`));
  }
  return lines.join('\r\n') + '\r\n';
}

/** Deletes exactly the values windowsReg wrote ("name"=-), never whole vendor keys. */
export function windowsRevertReg(opts: RegOptions): string {
  const applied = windowsReg(opts).split('\r\n');
  const out = ['Windows Registry Editor Version 5.00', '', '; AI Off: revert. Removes only the values AI Off set.'];
  for (const line of applied.slice(2)) {
    if (line.startsWith('[')) {
      // list subkeys (values named 1..n) are removed whole
      out.push('', /\\(GeminiActOnWebBlockedForURLs)\]$/.test(line) ? line.replace('[', '[-') : line);
    } else if (/^"[^"]+"=/.test(line)) out.push(line.replace(/=.*/, '=-'));
  }
  return out.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- plist / mobileconfig

function xml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function plistValue(v: unknown, indent = '\t'): string {
  if (typeof v === 'boolean') return `${indent}<${v}/>`;
  if (typeof v === 'number') return `${indent}<integer>${v}</integer>`;
  if (typeof v === 'string') return `${indent}<string>${xml(v)}</string>`;
  if (Array.isArray(v)) return `${indent}<array>\n${v.map((x) => plistValue(x, indent + '\t')).join('\n')}\n${indent}</array>`;
  if (v && typeof v === 'object') {
    const rows = Object.entries(v as Record<string, unknown>).map(([k, val]) => `${indent}\t<key>${xml(k)}</key>\n${plistValue(val, indent + '\t')}`);
    return `${indent}<dict>\n${rows.join('\n')}\n${indent}</dict>`;
  }
  return `${indent}<string></string>`;
}

const PLIST_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n';

export function macPolicyDict(id: BrowserId): Record<string, unknown> {
  if (id === 'firefox') return { EnterprisePoliciesEnabled: true, ...firefox().policiesJson.policies };
  return { ...chromium(id).policies };
}

/** Plist for /Library/Managed Preferences/<domain>.plist (or a Jamf Custom Settings / Intune preference file upload). */
export function macManagedPlist(id: BrowserId): string {
  return `${PLIST_HEAD}${plistValue(macPolicyDict(id), '')}\n</plist>\n`;
}

/** Deterministic UUID from a label, so regenerated profiles replace earlier ones instead of piling up. */
export function stableUuid(label: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const hex: string[] = [];
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < label.length; i++) {
      h1 = Math.imul(h1 ^ label.charCodeAt(i), 0x01000193) >>> 0;
      h2 = Math.imul(h2 + label.charCodeAt(i) + round, 0x85ebca6b) >>> 0;
    }
    hex.push(h1.toString(16).padStart(8, '0'), h2.toString(16).padStart(8, '0'));
  }
  const s = hex.join('').slice(0, 32).toUpperCase();
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-A${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

export interface MobileconfigOptions {
  browsers: BrowserId[];
  /** Include the Apple Intelligence restrictions payload (manual-install capable keys only). */
  appleIntelligence?: boolean;
  organization?: string;
  identifier?: string;
  /** Extra managed-preference payloads, e.g. extension config keyed by preference domain. */
  extraDomains?: Record<string, Record<string, unknown>>;
}

export function macMobileconfig(opts: MobileconfigOptions): string {
  const identifier = opts.identifier ?? 'app.aioff.profile';
  const payloads: Record<string, unknown>[] = [];
  const domains: Record<string, Record<string, unknown>> = { ...(opts.extraDomains ?? {}) };
  for (const id of opts.browsers) domains[id === 'firefox' ? firefox().macDomain : chromium(id).macDomain] = macPolicyDict(id);
  for (const [domain, dict] of Object.entries(domains)) {
    payloads.push({
      PayloadType: domain,
      PayloadVersion: 1,
      PayloadIdentifier: `${identifier}.${domain}`,
      PayloadUUID: stableUuid(`${identifier}.${domain}`),
      PayloadDisplayName: `AI Off: ${domain}`,
      PayloadEnabled: true,
      ...dict,
    });
  }
  if (opts.appleIntelligence) {
    const dict: Record<string, unknown> = {};
    for (const k of manualMacKeys()) dict[k.key] = k.valueToDisable;
    payloads.push({
      PayloadType: 'com.apple.applicationaccess',
      PayloadVersion: 1,
      PayloadIdentifier: `${identifier}.restrictions`,
      PayloadUUID: stableUuid(`${identifier}.restrictions`),
      PayloadDisplayName: 'AI Off: Apple Intelligence restrictions',
      PayloadEnabled: true,
      ...dict,
    });
  }
  const root = {
    PayloadContent: payloads,
    PayloadDisplayName: 'AI Off',
    PayloadDescription:
      'Turns off built-in AI features. Installed by you, removable by you at any time in System Settings, General, Device Management. Browsers will say they are managed by your organization: that organization is you.',
    PayloadIdentifier: identifier,
    PayloadOrganization: opts.organization ?? 'AI Off',
    PayloadRemovalDisallowed: false,
    PayloadScope: 'System',
    PayloadType: 'Configuration',
    PayloadUUID: stableUuid(identifier),
    PayloadVersion: 1,
  };
  return `${PLIST_HEAD}${plistValue(root, '')}\n</plist>\n`;
}

/** Shell script for the no-MDM route on macOS. Needs root. Firefox uses the documented /Library/Preferences route. */
export function macApplyScript(ids: BrowserId[], plistDir = '.'): string {
  const lines = [
    '#!/bin/sh',
    '# AI Off: apply browser policies on macOS without MDM. Run with sudo. Revert with aioff-revert-macos.sh.',
    '# Chrome, Edge, and Brave only honor mandatory policy from /Library/Managed Preferences (vendor-documented by Brave;',
    '# same Chromium loader for Chrome and Edge). macOS may clear that folder at boot, so AI Off re-checks on launch.',
    'set -eu',
    'if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi',
    'MP="/Library/Managed Preferences"',
    'mkdir -p "$MP"; chown root:wheel "$MP"; chmod 755 "$MP"',
  ];
  for (const id of ids) {
    if (id === 'firefox') {
      lines.push(`install -m 644 -o root -g wheel "${plistDir}/${firefox().macDomain}.plist" "/Library/Preferences/${firefox().macDomain}.plist.aioff-new"`);
      lines.push(`/usr/bin/plutil -convert binary1 "/Library/Preferences/${firefox().macDomain}.plist.aioff-new" && mv "/Library/Preferences/${firefox().macDomain}.plist.aioff-new" "/Library/Preferences/${firefox().macDomain}.plist"`);
    } else {
      const d = chromium(id).macDomain;
      lines.push(`install -m 644 -o root -g wheel "${plistDir}/${d}.plist" "$MP/${d}.plist"`);
    }
  }
  lines.push('killall cfprefsd 2>/dev/null || true', 'echo "Done. Restart your browsers, then check chrome://policy, edge://policy, brave://policy, or about:policies."');
  return lines.join('\n') + '\n';
}

export function macRevertScript(ids: BrowserId[]): string {
  const lines = ['#!/bin/sh', '# AI Off: remove the browser policies AI Off installed. Run with sudo.', 'set -eu', 'if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi'];
  for (const id of ids) {
    if (id === 'firefox') lines.push(`rm -f "/Library/Preferences/${firefox().macDomain}.plist"`);
    else lines.push(`rm -f "/Library/Managed Preferences/${chromium(id).macDomain}.plist"`);
  }
  lines.push('killall cfprefsd 2>/dev/null || true', 'echo "Removed. Restart your browsers."');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- Linux

export function linuxPolicyFile(id: BrowserId): { path: string; content: string } {
  if (id === 'firefox') return { path: firefox().linuxFile, content: JSON.stringify(firefox().policiesJson, null, 2) + '\n' };
  return { path: `${chromium(id).linuxDir}/aioff.json`, content: JSON.stringify(chromium(id).policies, null, 2) + '\n' };
}

// ---------------------------------------------------------------- Schools: extension deployment

export const CWS_UPDATE_URL = 'https://clients2.google.com/service/update2/crx';
export const EDGE_UPDATE_URL = 'https://edge.microsoft.com/extensionwebstorebase/v1/crx';

export interface ManagedConfigLike {
  [key: string]: unknown;
}

/** Google Admin console "Policy for extensions" wants every key wrapped in { "Value": ... }. Flat JSON fails silently there. */
export function googleAdminExtensionPolicy(config: ManagedConfigLike): string {
  const wrapped: Record<string, { Value: unknown }> = {};
  for (const [k, v] of Object.entries(config)) if (v !== undefined) wrapped[k] = { Value: v };
  return JSON.stringify(wrapped, null, 2);
}

export function extensionSettingsPolicy(extensionId: string, updateUrl = CWS_UPDATE_URL): Record<string, unknown> {
  return { [extensionId]: { installation_mode: 'force_installed', update_url: updateUrl, toolbar_pin: 'force_pinned' } };
}

/** Registry file for Windows (GPO-less or Intune script): force install plus managed storage under 3rdparty. */
export function windowsExtensionReg(browser: 'chrome' | 'edge', extensionId: string, config: ManagedConfigLike): string {
  const base = `HKEY_LOCAL_MACHINE\\${chromium(browser).windowsKey}`;
  const updateUrl = browser === 'edge' ? EDGE_UPDATE_URL : CWS_UPDATE_URL;
  const lines = ['Windows Registry Editor Version 5.00', '', `[${base}\\ExtensionInstallForcelist]`, `"1"=${regValue(`${extensionId};${updateUrl}`)}`];
  const policyKey = `${base}\\3rdparty\\extensions\\${extensionId}\\policy`;
  const walk = (key: string, obj: Record<string, unknown>) => {
    const scalars = Object.entries(obj).filter(([, v]) => v !== undefined && (typeof v !== 'object' || v === null));
    lines.push('', `[${key}]`, ...scalars.map(([k, v]) => `"${k}"=${regValue(v as PolicyValue)}`));
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        lines.push('', `[${key}\\${k}]`);
        v.forEach((item, i) => {
          if (item && typeof item === 'object') walk(`${key}\\${k}\\${i + 1}`, item as Record<string, unknown>);
          else lines.push(`"${i + 1}"=${regValue(item as PolicyValue)}`);
        });
      } else if (v && typeof v === 'object') walk(`${key}\\${k}`, v as Record<string, unknown>);
    }
  };
  walk(policyKey, config);
  return lines.join('\r\n') + '\r\n';
}

/** Jamf Custom Settings / Intune preference file: one plist per preference domain. */
export function macExtensionPlists(browser: 'chrome' | 'edge', extensionId: string, config: ManagedConfigLike): Record<string, string> {
  const domain = chromium(browser).macDomain;
  const updateUrl = browser === 'edge' ? EDGE_UPDATE_URL : CWS_UPDATE_URL;
  return {
    [`${domain}.plist`]: `${PLIST_HEAD}${plistValue({ ...chromium(browser).policies, ExtensionSettings: extensionSettingsPolicy(extensionId, updateUrl) }, '')}\n</plist>\n`,
    [`${domain}.extensions.${extensionId}.plist`]: `${PLIST_HEAD}${plistValue(config, '')}\n</plist>\n`,
  };
}

/**
 * Firefox policies.json with managed storage, and force install only when a published listing slug
 * exists (null before the AMO listing is live, so nobody deploys a link to nothing).
 */
export function firefoxSchoolPolicies(geckoId: string, amoSlug: string | null, config: ManagedConfigLike): string {
  return (
    JSON.stringify(
      {
        policies: {
          ...firefox().policiesJson.policies,
          ...(amoSlug
            ? {
                ExtensionSettings: {
                  [geckoId]: { installation_mode: 'force_installed', install_url: `https://addons.mozilla.org/firefox/downloads/latest/${amoSlug}/latest.xpi` },
                },
              }
            : {}),
          '3rdparty': { Extensions: { [geckoId]: config } },
        },
      },
      null,
      2,
    ) + '\n'
  );
}

/** Chromebook / Chrome browser cloud policy pack. GenAiDefaultSettings works here (and only here). */
export function googleAdminBrowserPolicies(): Record<string, PolicyValue> {
  return { GenAiDefaultSettings: 2, ...chromium('chrome').policies, ...(chromium('chrome').chromeOsPolicies ?? {}) };
}
