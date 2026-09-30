import { describe, expect, it } from 'vitest';
import {
  checklist,
  chromium,
  defaultWindowsTweaks,
  firefoxSchoolPolicies,
  googleAdminBrowserPolicies,
  googleAdminExtensionPolicy,
  linuxPolicyFile,
  macExtensionPlists,
  macManagedPlist,
  macMobileconfig,
  manualMacKeys,
  stableUuid,
  windowsExtensionReg,
  windowsReg,
  windowsRevertReg,
} from '../src/index.ts';

describe('catalog', () => {
  it('never ships the cloud-only umbrella policy to local delivery formats', () => {
    expect(Object.keys(chromium('chrome').policies)).not.toContain('GenAiDefaultSettings');
    expect(windowsReg({ browsers: ['chrome'] })).not.toContain('GenAiDefaultSettings');
    expect(googleAdminBrowserPolicies().GenAiDefaultSettings).toBe(2); // cloud policy is the one place it works
  });
  it('covers the key Chrome, Edge, Brave, and Firefox switches', () => {
    expect(chromium('chrome').policies.GeminiSettings).toBe(1);
    expect(chromium('chrome').policies.HelpMeWriteSettings).toBe(2);
    expect(chromium('edge').policies.HubsSidebarEnabled).toBe(false);
    expect(chromium('brave').policies.BraveAIChatEnabled).toBe(false);
    const ff = JSON.parse(linuxPolicyFile('firefox').content);
    expect(ff.policies.AIControls.Default).toEqual({ Value: 'blocked', Locked: true });
    expect(ff.policies.GenerativeAI.Enabled).toBe(false);
  });
  it('only applies verified Windows tweaks by default, and never the disable-search hammer', () => {
    const ids = defaultWindowsTweaks().map((t) => t.id);
    expect(ids).toContain('recall-unavailable');
    expect(ids).toContain('click-to-do-off');
    expect(ids).not.toContain('search-ui-disable');
    expect(defaultWindowsTweaks().every((t) => t.verified)).toBe(true);
  });
  it('only uses macOS restriction keys that install manually on an unsupervised Mac', () => {
    const keys = manualMacKeys();
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.every((k) => !k.requiresSupervision && k.allowManualInstall)).toBe(true);
    expect(keys.map((k) => k.key)).toContain('allowWritingTools');
  });
  it('normalizes the checklist', () => {
    const items = checklist();
    expect(items.length).toBeGreaterThan(50);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.every((i) => ['yes', 'partial', 'no'].includes(i.canDisable))).toBe(true);
    expect(items.every((i) => i.steps.length > 0 && i.lastVerified)).toBe(true);
  });
});

describe('generators', () => {
  it('writes a .reg file with dwords and a revert that only removes what was set', () => {
    const reg = windowsReg({ browsers: ['chrome', 'firefox'], tweaks: defaultWindowsTweaks().slice(0, 2) });
    expect(reg.startsWith('Windows Registry Editor Version 5.00\r\n')).toBe(true);
    expect(reg).toContain('[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome]');
    expect(reg).toContain('"GeminiSettings"=dword:00000001');
    expect(reg).toContain('"BuiltInAIAPIsEnabled"=dword:00000000');
    expect(reg).toContain('[HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Mozilla\\Firefox\\AIControls\\Default]');
    expect(reg).toContain('"Value"="blocked"');
    expect(reg).toContain('"AllowRecallEnablement"=dword:00000000');
    const revert = windowsRevertReg({ browsers: ['chrome'] });
    expect(revert).toContain('"GeminiSettings"=-');
    expect(revert).not.toMatch(/\[-HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome\]/); // never deletes the vendor key
  });
  it('writes valid-looking plists and a removable profile', () => {
    const plist = macManagedPlist('chrome');
    expect(plist).toContain('<key>GeminiSettings</key>\n\t<integer>1</integer>');
    expect(plist).toContain('<key>BuiltInAIAPIsEnabled</key>\n\t<false/>');
    expect(macManagedPlist('firefox')).toContain('<key>EnterprisePoliciesEnabled</key>\n\t<true/>');
    const profile = macMobileconfig({ browsers: ['chrome', 'brave'], appleIntelligence: true });
    expect(profile).toContain('<string>com.google.Chrome</string>');
    expect(profile).toContain('<string>com.apple.applicationaccess</string>');
    expect(profile).toContain('<key>allowWritingTools</key>');
    expect(profile).toContain('<key>PayloadRemovalDisallowed</key>\n\t<false/>');
    expect(stableUuid('a')).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-A[0-9A-F]{3}-[0-9A-F]{12}$/);
    expect(stableUuid('a')).toBe(stableUuid('a'));
    expect(stableUuid('a')).not.toBe(stableUuid('b'));
  });
  it('wraps Google Admin extension policy in Value objects and leaves Firefox flat', () => {
    const cfg = { orgName: 'Lincoln High School', level: 2, locked: true, allowSites: ['khanmigo.org'] };
    expect(JSON.parse(googleAdminExtensionPolicy(cfg))).toEqual({
      orgName: { Value: 'Lincoln High School' },
      level: { Value: 2 },
      locked: { Value: true },
      allowSites: { Value: ['khanmigo.org'] },
    });
    const ff = JSON.parse(firefoxSchoolPolicies('aioff@aioff.app', 'ai-off', cfg));
    expect(ff.policies['3rdparty'].Extensions['aioff@aioff.app']).toEqual(cfg);
    expect(ff.policies.ExtensionSettings['aioff@aioff.app'].installation_mode).toBe('force_installed');
    const noListing = JSON.parse(firefoxSchoolPolicies('aioff@aioff.app', null, cfg));
    expect(noListing.policies.ExtensionSettings).toBeUndefined(); // no force-install link before the listing exists
    expect(noListing.policies['3rdparty'].Extensions['aioff@aioff.app']).toEqual(cfg);
  });
  it('writes managed storage under 3rdparty for Windows and per-extension domains for macOS', () => {
    const id = 'a'.repeat(32);
    const reg = windowsExtensionReg('chrome', id, { orgName: 'X', level: 2, locked: true, allowSites: ['a.com', 'b.com'], examMode: { enabled: false } });
    expect(reg).toContain(`\\3rdparty\\extensions\\${id}\\policy]`);
    expect(reg).toContain('"level"=dword:00000002');
    expect(reg).toContain(`\\policy\\allowSites]\r\n"1"="a.com"\r\n"2"="b.com"`);
    expect(reg).toContain(`\\policy\\examMode]\r\n"enabled"=dword:00000000`);
    expect(reg).toContain(`"1"="${id};https://clients2.google.com/service/update2/crx"`);
    const plists = macExtensionPlists('chrome', id, { level: 2 });
    expect(Object.keys(plists)).toEqual(['com.google.Chrome.plist', `com.google.Chrome.extensions.${id}.plist`]);
    expect(plists['com.google.Chrome.plist']).toContain('force_installed');
  });
});
