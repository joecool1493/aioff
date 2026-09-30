import { browser } from 'wxt/browser';
import { isLocked } from '@aioff/core';
import { getStore, mergeManaged, updateSettings } from '../../lib/storage';

// The redirect rule appends the blocked URL as ?u=<url> exactly as it was (declarativeNetRequest cannot
// encode), so take everything after "?u=" as is rather than going through URLSearchParams.
const raw = location.search.startsWith('?u=') ? location.search.slice(3) : '';
let target: URL | null = null;
try {
  target = /^https?:\/\//i.test(raw) ? new URL(raw) : null;
} catch {
  target = null;
}
document.getElementById('host')!.textContent = target ? target.hostname : 'this site';

/** Apply a settings change, wait until the background has rewritten the network rules (at most 2 seconds), then move on. */
async function change(apply: () => Promise<unknown>, go: () => void): Promise<void> {
  const snapshot = async () => JSON.stringify(await browser.declarativeNetRequest.getDynamicRules().catch(() => []));
  const before = await snapshot();
  await apply();
  const start = Date.now();
  while (Date.now() - start < 2000 && (await snapshot()) === before) await new Promise((r) => setTimeout(r, 100));
  go();
}
// Where to go once the block is lifted: the page the visitor asked for, or back if the URL did not arrive.
const onward = () => (target ? location.replace(target.href) : history.back());

document.getElementById('back')!.addEventListener('click', () => history.back());
const { managed, managedRemote } = await getStore('managed', 'managedRemote');
const m = mergeManaged(managed, managedRemote);
if (isLocked(m)) {
  document.getElementById('why')!.textContent = `This site is blocked on this device. AI Off is managed by ${m?.orgName ?? 'your organization'}.`;
  document.getElementById('actions')!.remove();
} else {
  document.getElementById('pause')!.addEventListener('click', () => change(() => updateSettings((s) => ({ ...s, pauseUntil: Date.now() + 15 * 60_000 })), onward));
  document.getElementById('level')!.addEventListener('click', () => change(() => updateSettings((s) => ({ ...s, level: 3 })), onward));
}
