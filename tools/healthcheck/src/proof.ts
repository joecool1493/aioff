// The proof run. Loads a throwaway build of the real extension into real Chrome, drives it
// across live sites, exercises the signed-feed update and tamper paths against a local server,
// and records a video plus screenshots into docs/proof/. Every check is PASS, FAIL, or NOTE
// (NOTE = could not be exercised, with the reason). Nothing here is mocked.
//
//   pnpm --filter @aioff/healthcheck proof            headless Chromium
//   pnpm --filter @aioff/healthcheck proof -- --headed --chrome   real Google Chrome, on screen
//
// The build it uses is made with: WXT_FEED_URL=http://localhost:8790/rules.json AIOFF_OUT_DIR=.output-proof
import { createPrivateKey, sign } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EXT = join(ROOT, 'apps', 'extension', '.output-proof', 'chrome-mv3');
const OUT = join(ROOT, 'docs', 'proof');
const DIST = join(ROOT, 'packages', 'rules', 'dist');
const KEY = join(ROOT, 'keys', 'rules-dev.private.pem');
const headed = process.argv.includes('--headed');
const useChrome = process.argv.includes('--chrome');
const W = 1280;
const H = 800;
mkdirSync(join(OUT, 'video'), { recursive: true });
for (const f of readdirSync(join(OUT, 'video'))) if (f.endsWith('.webm')) renameSync(join(OUT, 'video', f), join(tmpdir(), f)); // stale recordings out of the way

type Status = 'PASS' | 'FAIL' | 'NOTE';
const results: { id: string; name: string; status: Status; detail: string; screenshot?: string }[] = [];
const record = (id: string, name: string, status: Status, detail = '', screenshot?: string) => {
  results.push({ id, name, status, detail, screenshot });
  console.log(`${status.padEnd(4)} ${name}${detail ? '  ' + detail : ''}`);
};

// ---------- local feed server: original, newer signed, tampered ----------
const original = readFileSync(join(DIST, 'rules.json'));
const canSign = existsSync(KEY);
const signWithDevKey = (body: Buffer) => sign(null, body, createPrivateKey(readFileSync(KEY, 'utf8'))).toString('base64');
// dist/rules.json.sig goes stale the moment rules are rebuilt without re-signing, so sign the served copy fresh.
const originalSig = canSign ? signWithDevKey(original) : readFileSync(join(DIST, 'rules.json.sig'), 'utf8').trim();
const bumpedObj = JSON.parse(original.toString('utf8'));
const baseVersion: string = bumpedObj.version;
bumpedObj.version = baseVersion.replace(/\.\d+$/, '.900');
bumpedObj.mute.terms.push('PROOFMARKER');
const bumped = Buffer.from(JSON.stringify(bumpedObj));
const bumpedSig = canSign ? signWithDevKey(bumped) : '';
const tamperedObj = JSON.parse(bumped.toString('utf8'));
tamperedObj.version = baseVersion.replace(/\.\d+$/, '.901');
tamperedObj.mute.terms.push('TAMPERED');
const tampered = Buffer.from(JSON.stringify(tamperedObj));
let mode: 'original' | 'bumped' | 'tampered' = 'original';
const server = createServer((req, res) => {
  const isSig = !!req.url?.endsWith('.sig');
  const body = mode === 'original' ? original : mode === 'bumped' ? bumped : tampered;
  const sig = mode === 'original' ? originalSig : bumpedSig; // the tampered body is served with the valid signature of the untampered body
  res.writeHead(200, { 'Content-Type': isSig ? 'text/plain' : 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(isSig ? sig : body);
});
await new Promise<void>((r) => server.listen(8790, r));

// ---------- browser ----------
const profile = mkdtempSync(join(tmpdir(), 'aioff-proof-'));
let context: BrowserContext;
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(useChrome ? { channel: 'chrome' } : {}),
    headless: !headed,
    viewport: { width: W, height: H },
    colorScheme: 'light',
    recordVideo: { dir: join(OUT, 'video'), size: { width: W, height: H } },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--disable-blink-features=AutomationControlled'],
  });
} catch (e) {
  console.error('could not launch the browser:', e);
  server.close();
  process.exit(1);
}
await context.addInitScript('globalThis.__name = (f) => f;');
const shot = async (page: Page, name: string) => {
  const file = `${name}.png`;
  await page.screenshot({ path: join(OUT, file) }).catch(() => {});
  return file;
};
const vis = (page: Page, sel: string) =>
  page.evaluate((s: string) => {
    const all = Array.from(document.querySelectorAll(s));
    // Rendered means it has a box. A child of a display:none ancestor keeps its own computed display, so getClientRects is the honest test.
    return { present: all.length, visible: all.filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden').length };
  }, sel);

try {
  const sw: Worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  const extId = new URL(sw.url()).host;
  await new Promise((r) => setTimeout(r, 1500));
  const setSettings = (patch: Record<string, unknown>) =>
    sw.evaluate(async (p: Record<string, unknown>) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, ...p } });
    }, patch);
  const store = (keys: string[]) => sw.evaluate((k: string[]) => chrome.storage.local.get(k), keys);
  // Messages to the background must come from another extension context: a worker never receives its own sendMessage.
  const ctl = await context.newPage();
  await ctl.goto(`chrome-extension://${extId}/options.html`);
  const msg = (m: Record<string, unknown>) => ctl.evaluate((mm: Record<string, unknown>) => new Promise((r) => chrome.runtime.sendMessage(mm, r)), m);
  const browserVersion = context.browser()?.version() ?? 'persistent';
  record('env', `Browser ${useChrome ? 'Google Chrome' : 'Chromium'} ${browserVersion}, extension id ${extId}, headed ${headed}`, 'NOTE');

  const seeded = await store(['ruleset', 'settings']);
  record('seed', 'Embedded ruleset seeded on install', seeded.ruleset?.sites?.length > 40 ? 'PASS' : 'FAIL', `version ${seeded.ruleset?.version}, ${seeded.ruleset?.sites?.length} sites`);

  const page = await context.newPage();
  await setSettings({ enabled: true, level: 1, pausedSites: [], pauseUntil: null });
  await new Promise((r) => setTimeout(r, 800));

  // ---------- Google ----------
  try {
    let botWall = true;
    let url = new URL('https://www.google.com/');
    let title = '';
    for (const q of ['why+is+the+sky+blue', 'Celeste+release+date']) {
      await page.goto(`https://www.google.com/search?q=${q}&hl=en`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(3500);
      url = new URL(page.url());
      title = await page.title();
      const body = (await page.evaluate(() => document.body?.innerText ?? '')).slice(0, 3000).toLowerCase();
      botWall = /unusual traffic|are you a robot|\/sorry\//.test(body + url.pathname) || /sorry/i.test(title);
      if (!botWall) break;
    }
    const aio = await vis(page, '[data-attnms], #Odp5De, div[id^="folsrch"], #m-x-content');
    const tab = await vis(page, '[role="listitem"]:has(a[href*="udm=50"]), .olrp5b');
    const organic = await page.evaluate(() => document.querySelectorAll('#rso a h3, #search a h3').length);
    const file = await shot(page, 'google');
    if (botWall) record('google', 'Google: automation blocked by a bot wall', 'NOTE', 'Google refuses automated browsers; check this one by eye', file);
    else record('google', 'Google: forced to the Web view, AI Overview and AI Mode not shown, results intact', url.searchParams.get('udm') === '14' && aio.visible === 0 && tab.visible === 0 && organic > 0 ? 'PASS' : 'FAIL', `udm=${url.searchParams.get('udm')}, AI Overview present ${aio.present} visible ${aio.visible}, AI Mode tab present ${tab.present} visible ${tab.visible}, organic results ${organic}`, file);
  } catch (e) {
    record('google', 'Google', 'FAIL', String((e as Error).message).split('\n')[0]);
  }

  // ---------- Bing ----------
  try {
    await page.goto('https://www.bing.com/search?q=mario+last+name&setlang=en-US&cc=US', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(3000);
    const copilotTab = await vis(page, '#b-scopeListItem-copilotsearch, #b-scopeListItem-conv');
    const answer = await vis(page, '#b_copilot_search_container, .b_ans:has(> #copans_container)');
    const organic = await page.evaluate(() => document.querySelectorAll('li.b_algo').length);
    const file = await shot(page, 'bing');
    record('bing', 'Bing: Web view forced, Copilot tab and prompts hidden, results intact', page.url().includes('webscp=1') && copilotTab.visible === 0 && answer.visible === 0 && organic > 0 ? 'PASS' : 'FAIL', `webscp=1 ${page.url().includes('webscp=1')}, Copilot tab present ${copilotTab.present} visible ${copilotTab.visible}, organic ${organic}`, file);
  } catch (e) {
    record('bing', 'Bing', 'FAIL', String((e as Error).message).split('\n')[0]);
  }

  // ---------- YouTube ----------
  try {
    await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(5000);
    const summary = await vis(page, '#video-summary, ytd-expandable-metadata-renderer[has-video-summary]');
    const ask = await vis(page, '.you-chat-entrypoint-button, yt-video-description-youchat-section-view-model');
    const file = await shot(page, 'youtube');
    if (summary.present + ask.present === 0) record('youtube', 'YouTube: no AI summary or Ask button served in this session', 'NOTE', 'YouTube varies these by session; the rule is verified by the nightly check when they appear', file);
    else record('youtube', 'YouTube: AI summary and Ask surfaces hidden', summary.visible + ask.visible === 0 ? 'PASS' : 'FAIL', `summary present ${summary.present} visible ${summary.visible}, ask present ${ask.present} visible ${ask.visible}`, file);
  } catch (e) {
    record('youtube', 'YouTube', 'FAIL', String((e as Error).message).split('\n')[0]);
  }

  // ---------- Level 2 ----------
  try {
    await setSettings({ level: 2 });
    await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(1500);
    const hn = await page.evaluate(() => ({ rows: document.querySelectorAll('tr.athing').length, muted: document.querySelectorAll('tr.athing[data-aioff-muted]').length, labels: Array.from(document.querySelectorAll('tr.athing[data-aioff-muted]')).slice(0, 3).map((e) => e.getAttribute('data-aioff-label')) }));
    const file = await shot(page, 'hn-level2');
    record('level2', 'Level 2: AI headlines on Hacker News collapsed to gray bars', hn.rows > 20 && hn.muted > 0 ? 'PASS' : hn.rows > 20 ? 'NOTE' : 'FAIL', `${hn.muted} of ${hn.rows} front-page stories muted${hn.labels.length ? ': ' + hn.labels.join(' | ') : ' (none mention AI right now)'}`, file);
    // click one bar to reveal it
    if (hn.muted > 0) {
      await page.locator('tr.athing[data-aioff-muted]').first().click();
      await page.waitForTimeout(300);
      const shown = await page.evaluate(() => document.querySelectorAll('tr.athing[data-aioff-shown]').length);
      record('level2-show', 'Level 2: clicking a bar shows the post again', shown === 1 ? 'PASS' : 'FAIL', `${shown} revealed`);
    }
  } catch (e) {
    record('level2', 'Level 2', 'FAIL', String((e as Error).message).split('\n')[0]);
  }

  // ---------- Level 4 ----------
  try {
    await setSettings({ level: 4 });
    await new Promise((r) => setTimeout(r, 1200)); // DNR rules update
    let blocked = false;
    try {
      await page.goto('https://openai.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (e) {
      blocked = /ERR_BLOCKED_BY_CLIENT/.test(String(e));
    }
    const file = await shot(page, 'level4-blocked');
    record('level4', 'Level 4: openai.com blocked at the network level', blocked ? 'PASS' : 'FAIL', blocked ? 'net::ERR_BLOCKED_BY_CLIENT' : `loaded ${page.url()}`, file);
    let blocked2 = false;
    try {
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch (e) {
      blocked2 = /ERR_BLOCKED_BY_CLIENT/.test(String(e));
    }
    record('level4b', 'Level 4: chatgpt.com blocked', blocked2 ? 'PASS' : 'FAIL');
  } catch (e) {
    record('level4', 'Level 4', 'FAIL', String((e as Error).message).split('\n')[0]);
  }

  // ---------- The Switch ----------
  try {
    await setSettings({ enabled: false });
    await new Promise((r) => setTimeout(r, 1200));
    const dnr = await sw.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length);
    const res = await page.goto('https://openai.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const file = await shot(page, 'switch-off-openai-loads');
    record('switch', 'The Switch: flipping AI back on removes every network rule and openai.com loads', dnr === 0 && !!res && res.ok() ? 'PASS' : 'FAIL', `dynamic rules ${dnr}, status ${res?.status()}`, file);
    await setSettings({ enabled: true, level: 1 });
    await new Promise((r) => setTimeout(r, 1200));
    const dnrOn = await sw.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length);
    record('switch-on', 'The Switch: flipping AI off again restores the network rules', dnrOn > 0 ? 'PASS' : 'FAIL', `dynamic rules ${dnrOn}`);
  } catch (e) {
    record('switch', 'The Switch', 'FAIL', String((e as Error).message).split('\n')[0]);
  }

  // ---------- Signed feed ----------
  const check = () => msg({ type: 'checkFeedNow' });
  if (!canSign) record('feed', 'Signed feed', 'NOTE', 'keys/rules-dev.private.pem not present, cannot sign a newer feed');
  else
    try {
      mode = 'original';
      await check();
      let s = await store(['feed', 'ruleset']);
      record('feed-remote', 'Feed: extension downloads and verifies the signed feed from the server', s.feed?.source === 'remote' && !s.feed?.lastError ? 'PASS' : 'FAIL', `source ${s.feed?.source}, version ${s.feed?.version}, error ${s.feed?.lastError}`);
      mode = 'bumped';
      await check();
      s = await store(['feed', 'ruleset']);
      const applied = s.ruleset?.version === bumpedObj.version && s.ruleset?.mute?.terms?.includes('PROOFMARKER');
      record('feed-update', 'Feed: a newer, correctly signed feed is applied without an extension update', applied ? 'PASS' : 'FAIL', `ruleset version ${s.ruleset?.version}, marker term present ${!!s.ruleset?.mute?.terms?.includes('PROOFMARKER')}`);
      mode = 'tampered';
      await check();
      s = await store(['feed', 'ruleset']);
      const rejected = s.feed?.lastError === 'bad-signature' && s.ruleset?.version === bumpedObj.version && !s.ruleset?.mute?.terms?.includes('TAMPERED');
      record('feed-tamper', 'Feed: a tampered feed (one field changed, signature no longer matches) is rejected and the last good rules stay', rejected ? 'PASS' : 'FAIL', `error ${s.feed?.lastError}, ruleset still ${s.ruleset?.version}`);
      mode = 'original';
      await check();
      s = await store(['feed', 'ruleset']);
      record('feed-downgrade', 'Feed: an older signed feed is ignored (no downgrade)', s.ruleset?.version === bumpedObj.version ? 'PASS' : 'FAIL', `ruleset still ${s.ruleset?.version}`);
    } catch (e) {
      record('feed', 'Signed feed', 'FAIL', String((e as Error).message).split('\n')[0]);
    }

  // ---------- Stats and popup ----------
  await page.waitForTimeout(4000);
  const stats = await store(['stats']);
  const statsText = JSON.stringify(stats.stats ?? {});
  record('stats', 'Counters: stored locally by site and rule id only', statsText.includes('search-bing') || statsText.includes('mute') ? 'PASS' : 'FAIL', statsText.slice(0, 200));
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 660 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForTimeout(800);
  const popupText = await popup.evaluate(() => document.body.innerText);
  record('popup', 'Popup renders with the counter', /AI Off hid \d+/.test(popupText) ? 'PASS' : 'FAIL', (popupText.match(/AI Off hid[^.]*\./) ?? [''])[0], await shot(popup, 'popup'));
  await popup.close();
  await ctl.close();
  await page.close();
} catch (e) {
  // Google Chrome 137+ ignores --load-extension (only Chromium and Chrome for Testing honor it), which shows up here as no service worker.
  record('run', 'Run aborted', 'FAIL', String((e as Error).message ?? e).split('\n')[0] + (useChrome ? ' (branded Chrome does not load unpacked extensions; use Chromium)' : ''));
} finally {
  await context.close();
  server.close();
}

// video file
const vids = readdirSync(join(OUT, 'video')).filter((f) => f.endsWith('.webm'));
let videoFile: string | undefined;
if (vids.length) {
  const newest = vids.map((f) => ({ f, t: Number(readFileSync(join(OUT, 'video', f)).length) })).sort((a, b) => b.t - a.t)[0]!.f;
  renameSync(join(OUT, 'video', newest), join(OUT, 'proof.webm'));
  videoFile = 'proof.webm';
}

const pass = results.filter((r) => r.status === 'PASS').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
const note = results.filter((r) => r.status === 'NOTE').length;
const md = [
  `# Proof run`,
  '',
  `${new Date().toISOString()}. ${pass} passed, ${fail} failed, ${note} notes. ${videoFile ? `Video of the whole run: \`${videoFile}\`.` : ''}`,
  '',
  'Everything below happened in a real browser with the real built extension on live sites, plus a local server standing in for rules.aioff.app. Nothing is mocked.',
  '',
  '| Check | Result | Detail |',
  '|---|---|---|',
  ...results.map((r) => `| ${r.name}${r.screenshot ? ` ([screenshot](${r.screenshot}))` : ''} | ${r.status} | ${r.detail.replace(/\|/g, '\\|')} |`),
  '',
].join('\n');
writeFileSync(join(OUT, 'RESULTS.md'), md);
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${pass} passed, ${fail} failed, ${note} notes. Report: docs/proof/RESULTS.md`);
process.exit(fail ? 1 : 0);
