// Turns "what the user wants" into a list of plain actions. All the knowledge lives in
// @aioff/policies (tested TypeScript); the Rust side only executes and journals actions.
import {
  CHROMIUM_IDS,
  chromium,
  defaultWindowsTweaks,
  firefox,
  linuxPolicyFile,
  macManagedPlist,
  windowsReg,
  windowsRevertReg,
  type BrowserId,
} from '@aioff/policies';

export type Platform = 'macos' | 'windows' | 'linux';

export type Action =
  | { kind: 'write_file'; id: string; path: string; content: string; needs_admin: boolean; explain: string }
  | { kind: 'import_reg'; id: string; content: string; revert: string; needs_admin: boolean; explain: string };

export interface PlanItem {
  id: string;
  title: string;
  explain: string;
  needsAdmin: boolean;
  actions: Action[];
}

const MANAGED_NOTE =
  'Your browser will say "Managed by your organization". That appears because AI Off set policies on this computer. You are the organization, and Turn everything back on removes them.';

export function buildPlan(platform: Platform, installed: BrowserId[]): PlanItem[] {
  const items: PlanItem[] = [];
  const all: BrowserId[] = [...CHROMIUM_IDS, 'firefox'];
  for (const id of all.filter((b) => installed.includes(b))) {
    const name = id === 'firefox' ? firefox().name : chromium(id).name;
    const caveat = (id === 'firefox' ? firefox().caveat : chromium(id).caveat) ?? '';
    const base = { id: `browser-${id}`, title: `${name}: turn off built-in AI`, explain: `${MANAGED_NOTE} ${caveat}`.trim(), needsAdmin: true };
    if (platform === 'macos') {
      const domain = id === 'firefox' ? firefox().macDomain : chromium(id).macDomain;
      const path = id === 'firefox' ? `/Library/Preferences/${domain}.plist` : `/Library/Managed Preferences/${domain}.plist`;
      items.push({ ...base, actions: [{ kind: 'write_file', id: base.id, path, content: macManagedPlist(id), needs_admin: true, explain: base.title }] });
    } else if (platform === 'windows') {
      items.push({
        ...base,
        actions: [{ kind: 'import_reg', id: base.id, content: windowsReg({ browsers: [id] }), revert: windowsRevertReg({ browsers: [id] }), needs_admin: true, explain: base.title }],
      });
    } else {
      const f = linuxPolicyFile(id);
      items.push({ ...base, actions: [{ kind: 'write_file', id: base.id, path: f.path, content: f.content, needs_admin: true, explain: base.title }] });
    }
  }
  if (platform === 'windows') {
    for (const t of defaultWindowsTweaks()) {
      items.push({
        id: `win-${t.id}`,
        title: t.title,
        explain: `${t.hive}\\${t.path} ${t.name} = ${t.value}. Source: ${t.source}`,
        needsAdmin: t.needsAdmin,
        actions: [{ kind: 'import_reg', id: `win-${t.id}`, content: windowsReg({ browsers: [], tweaks: [t] }), revert: windowsRevertReg({ browsers: [], tweaks: [t] }), needs_admin: t.needsAdmin, explain: t.title }],
      });
    }
  }
  return items;
}
