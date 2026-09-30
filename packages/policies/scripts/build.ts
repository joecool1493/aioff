// Emits the policy pack: every delivery format, ready to hand to a user or a school IT admin.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHROMIUM_IDS,
  checklist,
  defaultWindowsTweaks,
  googleAdminBrowserPolicies,
  linuxPolicyFile,
  macApplyScript,
  macManagedPlist,
  macMobileconfig,
  macRevertScript,
  chromium,
  firefox,
  windowsReg,
  windowsRevertReg,
  type BrowserId,
} from '../src/index.ts';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'policy-pack');
const write = (rel: string, content: string, mode?: number) => {
  const p = join(DIST, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, mode ? { mode } : undefined);
};
const ALL: BrowserId[] = [...CHROMIUM_IDS, 'firefox'];
const DESKTOP: BrowserId[] = ['chrome', 'edge', 'brave', 'firefox'];

// Windows
write('windows/aioff-browsers.reg', windowsReg({ browsers: DESKTOP }));
write('windows/aioff-browsers-revert.reg', windowsRevertReg({ browsers: DESKTOP }));
write('windows/aioff-windows.reg', windowsReg({ browsers: [], tweaks: defaultWindowsTweaks() }));
write('windows/aioff-windows-revert.reg', windowsRevertReg({ browsers: [], tweaks: defaultWindowsTweaks() }));

// macOS
for (const id of DESKTOP) write(`macos/plists/${id === 'firefox' ? firefox().macDomain : chromium(id).macDomain}.plist`, macManagedPlist(id));
write('macos/aioff-apply-macos.sh', macApplyScript(DESKTOP, './plists'), 0o755);
write('macos/aioff-revert-macos.sh', macRevertScript(DESKTOP), 0o755);
write('macos/AI-Off-browsers.mobileconfig', macMobileconfig({ browsers: DESKTOP, identifier: 'app.aioff.browsers' }));
write('macos/AI-Off-apple-intelligence.mobileconfig', macMobileconfig({ browsers: [], appleIntelligence: true, identifier: 'app.aioff.appleintelligence' }));

// Linux
for (const id of ALL) {
  const f = linuxPolicyFile(id);
  write(`linux${f.path}`, f.content);
}

// Schools (cloud policy for Chromebooks and managed Chrome)
write('schools/google-admin-chrome-policies.json', JSON.stringify(googleAdminBrowserPolicies(), null, 2) + '\n');

// Checklists for the companion and the site
write('checklists.json', JSON.stringify(checklist(), null, 2) + '\n');

console.log(`policy pack written to ${DIST}`);
