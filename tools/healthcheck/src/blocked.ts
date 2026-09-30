// Real-browser check of the Level 4 blocked page: the redirect carries the URL that was asked for, the page
// names its host, and "Pause" or "Drop to Level 3" sends the visitor on to that site instead of back in history.
//
// The redirect to AI Off's own page needs host access, and automation cannot accept the optional permission
// prompt, so this runs against a build that carries all-sites access in its manifest (test builds only):
//
//   AIOFF_ALL_SITES=1 AIOFF_OUT_DIR=.output-allsites pnpm --filter @aioff/extension exec wxt build
//   pnpm --filter @aioff/healthcheck blocked            (add -- --headed to watch)
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Evaluated inside the extension's service worker, where `chrome` exists.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EXT = join(ROOT, 'apps', 'extension', '.output-allsites', 'chrome-mv3');
const OUT = join(ROOT, 'healthcheck-report', 'e2e');
mkdirSync(OUT, { recursive: true });

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'aioff-blocked-')), {
  channel: 'chromium',
  headless: !process.argv.includes('--headed'),
  viewport: { width: 1100, height: 760 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await context.addInitScript('globalThis.__name = (f) => f;');
try {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extId = new URL(sw.url()).host;
  await wait(1500);
  const setSettings = (patch: Record<string, unknown>) =>
    sw.evaluate(async (p: Record<string, unknown>) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, ...p } });
    }, patch);
  const getSettings = () => sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings);

  const hasAll = await sw.evaluate(() => chrome.permissions.contains({ origins: ['*://*/*'] }));
  check('test build carries all-sites access', hasAll === true);

  await setSettings({ enabled: true, level: 4, pausedSites: [], pauseUntil: null });
  await wait(1500);
  const rules = await sw.evaluate(async () => chrome.declarativeNetRequest.getDynamicRules());
  const nav = rules.find((r: { action?: { redirect?: { regexSubstitution?: string } } }) => r.action?.redirect?.regexSubstitution);
  check('the browser accepted the redirect rule that carries the blocked URL', !!nav, nav ? `${rules.length} rules, substitution ${nav.action.redirect.regexSubstitution}` : JSON.stringify(rules.map((r: { action: unknown }) => r.action)));

  const page = await context.newPage();
  const asked = 'https://chatgpt.com/?aioff=1&b=2';
  await page.goto(asked, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  await wait(800);
  check('a Blackout navigation lands on the blocked page with the asked URL attached', page.url() === `chrome-extension://${extId}/blocked.html?u=${asked}`, page.url());
  const text = await page.evaluate(() => document.body.innerText);
  check('the page names the blocked host', /AI Off blocked chatgpt\.com/.test(text), text.split('\n')[0]);
  await page.screenshot({ path: join(OUT, 'blocked-page.png') });

  await page.click('#pause');
  await page.waitForURL((u) => u.hostname === 'chatgpt.com', { timeout: 15_000 }).catch(() => {});
  const s1 = await getSettings();
  check('"Pause for 15 minutes" pauses and goes on to the site that was asked for', page.url().startsWith('https://chatgpt.com/') && s1.pauseUntil > Date.now(), `${page.url()}, pause ends in ${Math.round((s1.pauseUntil - Date.now()) / 60_000)} min`);

  await setSettings({ pauseUntil: null, level: 4 });
  await wait(1500);
  await page.goto('https://claude.ai/', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  await wait(800);
  check('blocked again once the pause is over', page.url() === `chrome-extension://${extId}/blocked.html?u=https://claude.ai/`, page.url());
  await page.click('#level');
  await page.waitForURL((u) => u.hostname === 'claude.ai', { timeout: 15_000 }).catch(() => {});
  const s2 = await getSettings();
  check('"Drop to Level 3" lowers the level and goes on to the site', page.url().startsWith('https://claude.ai/') && s2.level === 3, `${page.url()}, level ${s2.level}`);

  await page.goto(`chrome-extension://${extId}/blocked.html`);
  await wait(300);
  const plain = await page.evaluate(() => document.body.innerText);
  check('without a URL the page still renders and offers a way back', /AI Off blocked this site/.test(plain) && /Go back/.test(plain));

  // Not a Blackout site: Level 4 leaves it alone.
  await setSettings({ level: 4, pauseUntil: null });
  await wait(1200);
  const res = await page.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null);
  check('a site outside the list still loads at Level 4', !!res && res.ok() && page.url().startsWith('https://example.com/'), page.url());
} finally {
  await context.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
