// End-to-end smoke test: loads the built extension into real Chromium, visits live sites,
// and asserts the full pipeline (service worker boot, DNR redirect, CSS injection, counting,
// the Switch). Run after `pnpm ext:build`:  pnpm --filter @aioff/healthcheck e2e
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Evaluated inside the extension's service worker, where `chrome` exists.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EXT = join(ROOT, 'apps', 'extension', '.output', 'chrome-mv3');
const OUT = join(ROOT, 'healthcheck-report', 'e2e');
mkdirSync(OUT, { recursive: true });

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'aioff-e2e-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await context.addInitScript('globalThis.__name = (f) => f;');
try {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extId = new URL(sw.url()).host;
  check('service worker started', !!extId, extId);

  // Give onInstalled a moment to seed storage and DNR.
  await new Promise((r) => setTimeout(r, 1500));
  const state = await sw.evaluate(async () => {
    const s = await chrome.storage.local.get(['ruleset', 'settings', 'feed']);
    const dnr = await chrome.declarativeNetRequest.getDynamicRules();
    return { version: s.ruleset?.version, sites: s.ruleset?.sites?.length, dnr: dnr.length, redirects: dnr.filter((r: { action: { type: string } }) => r.action.type === 'redirect').length };
  });
  check('embedded ruleset seeded', !!state.version && state.sites > 40, JSON.stringify(state));
  check('DNR rules installed', state.dnr > 0 && state.redirects >= 3);

  // Bing: DNR redirect adds webscp=1, Copilot surfaces are hidden.
  const page = await context.newPage();
  await page.goto('https://www.bing.com/search?q=mario+last+name&setlang=en-US&cc=US', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(3000);
  check('Bing: url rewritten to the Web view', new URL(page.url()).searchParams.get('webscp') === '1', page.url());
  const bing = await page.evaluate(() => {
    const vis = (sel: string) => Array.from(document.querySelectorAll(sel)).filter((e) => getComputedStyle(e).display !== 'none').length;
    return { style: !!document.getElementById('aioff-style'), copilotTabVisible: vis('#b-scopeListItem-copilotsearch'), copilotTabPresent: document.querySelectorAll('#b-scopeListItem-copilotsearch').length, results: document.querySelectorAll('li.b_algo').length };
  });
  check('Bing: stylesheet injected', bing.style);
  check('Bing: Copilot tab hidden, organic results intact', bing.copilotTabVisible === 0 && bing.results > 0, JSON.stringify(bing));
  await page.screenshot({ path: join(OUT, 'bing-on.png') });

  // Flip the Switch off: everything must come back instantly, without a reload.
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, enabled: false } });
  });
  await page.waitForTimeout(800);
  const off = await page.evaluate(() => ({ style: !!document.getElementById('aioff-style'), askVisible: Array.from(document.querySelectorAll('#b-scopeListItem-copilotsearch')).filter((e) => getComputedStyle(e).display !== 'none').length }));
  const dnrOff = await sw.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length);
  check('Switch off: styles removed, Copilot tab back, DNR cleared', !off.style && off.askVisible > 0 && dnrOff === 0, JSON.stringify({ ...off, dnrOff }));
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, enabled: true } });
  });

  // Brave Search
  await page.goto('https://search.brave.com/search?q=why+is+the+sky+blue', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(3000);
  const brave = await page.evaluate(() => {
    const vis = (sel: string) => Array.from(document.querySelectorAll(sel)).filter((e) => getComputedStyle(e).display !== 'none').length;
    return { url: location.href, answerVisible: vis('#llm-snippet'), askVisible: vis('#submit-llm-button'), results: document.querySelectorAll('div.snippet').length };
  });
  if (brave.results === 0) console.log('SKIP  Brave served no results to automation (bot wall); url rewrite still checked');
  check('Brave: summary=0 applied, AI answer and Ask button hidden', brave.url.includes('summary=0') && brave.answerVisible === 0 && brave.askVisible === 0, JSON.stringify(brave));
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, level: 2 } });
  });

  // Level 2 muting on Hacker News (static HTML, reliable).
  await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(1500);
  const hn = await page.evaluate(() => ({ rows: document.querySelectorAll('tr.athing').length, muted: document.querySelectorAll('tr.athing[data-aioff-muted]').length, sample: document.querySelector('tr.athing[data-aioff-muted]')?.getAttribute('data-aioff-label') ?? '' }));
  check('Level 2: Hacker News rows scanned (muted count depends on the day)', hn.rows > 20, JSON.stringify(hn));
  await page.screenshot({ path: join(OUT, 'hn-level2.png') });

  // Counters reached the background (batched every 2s, flushed 1.5s later).
  await page.waitForTimeout(4500);
  const stats = await sw.evaluate(async () => (await chrome.storage.local.get('stats')).stats);
  check('stats recorded locally by site and rule only', JSON.stringify(stats).includes('search-b'), JSON.stringify(stats).slice(0, 300));

  // UI pages render.
  for (const [name, path, w, h] of [['popup', 'popup.html', 340, 640], ['options', 'options.html', 1000, 900]] as const) {
    const ui = await context.newPage();
    await ui.setViewportSize({ width: w, height: h });
    const errors: string[] = [];
    ui.on('pageerror', (e) => errors.push(e.message));
    await ui.goto(`chrome-extension://${extId}/${path}`);
    await ui.waitForTimeout(800);
    const text = await ui.evaluate(() => document.body.innerText);
    check(`${name} renders`, text.includes('AI OFF') && errors.length === 0, errors.join('; '));
    await ui.screenshot({ path: join(OUT, `${name}.png`) });
    await ui.close();
  }
} finally {
  await context.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
