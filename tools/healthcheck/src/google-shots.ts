// Launch images from a real Google search: a before and after pair for the stores and a short
// screen recording of the switch for social posts. Real extension, real page, nothing mocked.
// The only thing added to the page is a caption bar at the bottom of the recording, which says so.
//
// Google refuses headless browsers, so this runs Playwright's Chromium on screen with
// --disable-blink-features=AutomationControlled. It never tries to get past a bot check: if Google
// shows one, the run waits, tries another query, and then gives up and writes nothing for Google.
//
//   AIOFF_OUT_DIR=.output-shots pnpm --filter @aioff/extension build
//   pnpm --filter @aioff/healthcheck exec tsx src/google-shots.ts
//
// Flags: --shots-only, --video-only, --bing (record the video on Bing instead), --query="why is the sky blue".
// Stills go to docs/store/08..10; the video and its poster frame go to AIOFF_MEDIA_DIR
// (default ~/Desktop/aioff-store) and stay out of the repository. Needs python3 with Pillow for the
// side-by-side image and ffmpeg for MP4 (without ffmpeg the WebM is kept).
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page, type Worker } from 'playwright';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const EXT = join(ROOT, 'apps', 'extension', process.env.AIOFF_OUT_DIR || '.output-shots', 'chrome-mv3');
const STORE = join(ROOT, 'docs', 'store');
const MEDIA = process.env.AIOFF_MEDIA_DIR || join(homedir(), 'Desktop', 'aioff-store');
const W = 1280;
const H = 800;
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const queryArg = args.find((a) => a.startsWith('--query='))?.slice('--query='.length);
const QUERIES = queryArg ? [queryArg] : ['why is the sky blue', 'how do vaccines work', 'what causes tides', 'how to tie a bowline knot'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

if (!existsSync(join(EXT, 'manifest.json'))) {
  console.error(`no build at ${EXT}. Run: AIOFF_OUT_DIR=.output-shots pnpm --filter @aioff/extension build`);
  process.exit(1);
}

// ---------- sites ----------
// Same selectors as packages/rules/src/sites/search-google.json (g-aio-main) and search-bing.json.
const GOOGLE_AIO = '[data-attnms], #Odp5De, div[id^="folsrch"], #m-x-content, .YzCcne';
const BING_AI = '#b-scopeListItem-copilotsearch, #b-scopeListItem-conv, #b_copilot_search_container, .b_ans:has(> #copans_container)';

interface Site {
  name: 'google' | 'bing';
  url: (q: string) => string;
  aiSelector: string;
  /** Text that must be on screen for the AI element to count, or null. */
  aiHeading: string | null;
  webView: (u: URL) => boolean;
  organic: string;
  captionOff: string;
  captionOn: string;
}
const GOOGLE: Site = {
  name: 'google',
  url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q).replace(/%20/g, '+')}&hl=en&gl=us`,
  aiSelector: GOOGLE_AIO,
  aiHeading: 'AI Overview',
  webView: (u) => u.searchParams.get('udm') === '14',
  organic: '#rso a h3, #search a h3',
  captionOff: 'AI Off is paused. Google shows its AI Overview.',
  captionOn: 'AI Off switch flipped. No AI Overview, just the Web results.',
};
const BING: Site = {
  name: 'bing',
  url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q).replace(/%20/g, '+')}&setlang=en-US&cc=US`,
  aiSelector: BING_AI,
  aiHeading: null,
  webView: (u) => u.searchParams.get('webscp') === '1',
  organic: 'li.b_algo',
  captionOff: 'AI Off is paused. Bing shows Copilot.',
  captionOn: 'AI Off switch flipped. No Copilot, just the Web results.',
};

interface AiState {
  present: number;
  /** Matching elements with a box that overlaps the viewport. */
  inView: number;
  /** Tallest overlapping box, in CSS pixels. */
  tallest: number;
  heading: boolean;
  organic: number;
}
const aiState = (page: Page, site: Site): Promise<AiState> =>
  page.evaluate(
    ({ sel, heading, organic }: { sel: string; heading: string | null; organic: string }) => {
      const inViewport = (e: Element) => {
        if (e.getClientRects().length === 0 || getComputedStyle(e).visibility === 'hidden') return 0;
        const r = e.getBoundingClientRect();
        const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
        return r.width > 40 && h > 0 ? h : 0;
      };
      const all = Array.from(document.querySelectorAll(sel));
      const heights = all.map(inViewport).filter((h) => h > 0);
      let headingSeen = heading === null;
      if (heading) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (n.nodeValue?.trim() === heading && n.parentElement && !n.parentElement.closest('#aioff-demo-caption') && inViewport(n.parentElement) > 0) {
            headingSeen = true;
            break;
          }
        }
      }
      return { present: all.length, inView: heights.length, tallest: Math.round(Math.max(0, ...heights)), heading: headingSeen, organic: document.querySelectorAll(organic).length };
    },
    { sel: site.aiSelector, heading: site.aiHeading, organic: site.organic },
  );
const aiShown = (s: AiState) => s.inView > 0 && s.tallest >= 40 && s.heading;

const botWall = async (page: Page) => {
  const u = new URL(page.url());
  const text = (await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')).slice(0, 3000).toLowerCase();
  return u.pathname.startsWith('/sorry') || /unusual traffic|are you a robot|not a robot|verify you are human/.test(text) || (await page.locator('iframe[src*="recaptcha"], iframe[src*="captcha"]').count()) > 0;
};

// ---------- browser ----------
async function launch(videoDir?: string) {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'aioff-gshots-')), {
    headless: false,
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: W, height: H } } } : {}),
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--disable-blink-features=AutomationControlled', `--window-size=${W},${H + 90}`],
  });
  await context.addInitScript('globalThis.__name = (f) => f;'); // tsx wraps functions with a helper the page does not have
  const sw: Worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  await sleep(1500);
  const setSwitch = async (on: boolean) => {
    await sw.evaluate(async (enabled: boolean) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, enabled, level: 1, pausedSites: [], pauseUntil: null } });
    }, on);
  };
  return { context, setSwitch };
}

/** Wait until the AI element is (or is not) on screen. Returns the last state seen. */
async function waitAi(page: Page, site: Site, want: boolean, ms: number): Promise<AiState> {
  const until = Date.now() + ms;
  let s = await aiState(page, site);
  while (aiShown(s) !== want && Date.now() < until) {
    await page.waitForTimeout(400);
    s = await aiState(page, site).catch(() => s);
  }
  return s;
}

// ---------- stills ----------
async function stills(): Promise<string | null> {
  const tmp = mkdtempSync(join(tmpdir(), 'aioff-gstills-'));
  const { context, setSwitch } = await launch();
  let walls = 0;
  try {
    const page = await context.newPage();
    for (const q of QUERIES) {
      await setSwitch(false);
      await sleep(1200); // network rules update
      await page.goto(GOOGLE.url(q), { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(2500);
      if (await botWall(page)) {
        walls++;
        log(`"${q}": Google showed a bot check (${walls}). Not solving it.`);
        if (walls >= 3) break;
        await sleep(60_000);
        continue;
      }
      const before = await waitAi(page, GOOGLE, true, 12_000);
      log(`"${q}" before:`, JSON.stringify(before), page.url());
      if (!aiShown(before)) {
        log(`"${q}": no AI Overview in the viewport, trying the next query`);
        await sleep(15_000);
        continue;
      }
      await page.waitForTimeout(2500); // let the overview finish streaming in
      await page.mouse.move(W - 5, H - 5);
      await page.screenshot({ path: join(tmp, 'before.png') });
      const beforeFinal = await aiState(page, GOOGLE);

      await setSwitch(true);
      await sleep(1200);
      await page.goto(GOOGLE.url(q), { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(3500);
      if (await botWall(page)) {
        walls++;
        log(`"${q}": bot check on the after load (${walls}). Not solving it.`);
        if (walls >= 3) break;
        await sleep(60_000);
        continue;
      }
      const after = await aiState(page, GOOGLE);
      const u = new URL(page.url());
      log(`"${q}" after:`, JSON.stringify(after), page.url());
      if (!GOOGLE.webView(u) || after.inView > 0 || after.heading || after.organic === 0) {
        log(`"${q}": after state not clean, trying the next query`);
        await sleep(15_000);
        continue;
      }
      await page.screenshot({ path: join(tmp, 'after.png') });

      mkdirSync(STORE, { recursive: true });
      const b = join(STORE, '08-google-before.png');
      const a = join(STORE, '09-google-after.png');
      const c = join(STORE, '10-google-before-after.png');
      copyFileSync(join(tmp, 'before.png'), b);
      copyFileSync(join(tmp, 'after.png'), a);
      execFileSync('python3', [join(HERE, 'google-compose.py'), b, a, c, 'The AI Overview: gone. The results: untouched.', 'One click. No account. No AI inside.'], { stdio: 'inherit' });
      mkdirSync(MEDIA, { recursive: true });
      for (const f of [b, a, c]) copyFileSync(f, join(MEDIA, f.split('/').pop()!));
      log(`stills written for "${q}". AI Overview before: ${beforeFinal.inView} matching elements in view, tallest ${beforeFinal.tallest}px, heading on screen ${beforeFinal.heading}`);
      return q;
    }
    log('no Google stills: ' + (walls ? 'Google kept showing a bot check' : 'no query served an AI Overview'));
    return null;
  } finally {
    await context.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- video ----------
// The caption lives in sessionStorage so it survives the reload into the Web view.
const CAPTION_SCRIPT = `(() => {
  if (window.top !== window) return;
  const draw = () => {
    let text = '', on = false;
    try { text = sessionStorage.getItem('aioff-demo-caption') || ''; on = sessionStorage.getItem('aioff-demo-on') === '1'; } catch {}
    let bar = document.getElementById('aioff-demo-caption');
    if (!text) { if (bar) bar.remove(); return; }
    if (!document.documentElement) return;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'aioff-demo-caption';
      bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:52px;z-index:2147483647;display:flex;align-items:center;gap:14px;padding:0 24px;box-sizing:border-box;background:#f4f1ea;color:#242620;border-top:3px solid #a73825;font:500 20px/1 Helvetica,Arial,sans-serif;letter-spacing:0;';
      bar.innerHTML = '<span data-dot style="width:16px;height:16px;border-radius:50%;flex:none;box-sizing:border-box"></span><span data-text></span><span style="margin-left:auto;font-size:13px;font-weight:400;opacity:.65">caption added to this recording</span>';
      document.documentElement.appendChild(bar);
    }
    bar.querySelector('[data-text]').textContent = text;
    const dot = bar.querySelector('[data-dot]');
    dot.style.background = on ? '#a73825' : 'transparent';
    dot.style.border = on ? '0' : '2px solid #242620';
  };
  window.__aioffDemoCaption = draw;
  draw();
  document.addEventListener('DOMContentLoaded', draw);
})();`;

async function video(site: Site, queries: string[]): Promise<{ file: string; query: string } | null> {
  const dir = mkdtempSync(join(tmpdir(), 'aioff-gvideo-'));
  for (const q of queries) {
    for (const f of readdirSync(dir)) rmSync(join(dir, f));
    const { context, setSwitch } = await launch(dir);
    let ok = false;
    let trimStart = 0;
    let length = 0;
    try {
      await context.addInitScript(CAPTION_SCRIPT);
      await setSwitch(false);
      await sleep(1200);
      const page = await context.newPage();
      const t0 = Date.now();
      const caption = async (on: boolean) => {
        await page
          .evaluate(
            ({ text, isOn }: { text: string; isOn: boolean }) => {
              sessionStorage.setItem('aioff-demo-caption', text);
              sessionStorage.setItem('aioff-demo-on', isOn ? '1' : '0');
              (window as unknown as { __aioffDemoCaption?: () => void }).__aioffDemoCaption?.();
            },
            { text: on ? site.captionOn : site.captionOff, isOn: on },
          )
          .catch(() => {});
      };
      const flip = async (on: boolean, hold: number): Promise<boolean> => {
        await caption(on);
        await setSwitch(on);
        if (on) {
          // The content script moves the page to the Web view on its own; reload only if it has not.
          await page.waitForURL((u) => site.webView(u), { timeout: 4000 }).catch(() => {});
          if (!site.webView(new URL(page.url()))) {
            log('page did not move by itself, reloading the search');
            await page.goto(site.url(q), { waitUntil: 'domcontentloaded', timeout: 45_000 });
          }
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await caption(true);
          const s = await waitAi(page, site, false, 6000);
          log('on:', JSON.stringify(s), page.url());
          if (aiShown(s) || s.inView > 0 || !site.webView(new URL(page.url()))) return false;
        } else {
          // Off: load the plain search again, the way a person would after pausing.
          await sleep(1200);
          await page.goto(site.url(q), { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await caption(false);
          if (await botWall(page)) return false;
          const s = await waitAi(page, site, true, 12_000);
          log('off:', JSON.stringify(s), page.url());
          if (!aiShown(s)) return false;
        }
        await page.waitForTimeout(hold);
        return true;
      };

      await page.goto(site.url(q), { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(2000);
      if (await botWall(page)) {
        log(`video "${q}": ${site.name} showed a bot check. Not solving it.`);
        await sleep(45_000);
        continue;
      }
      const first = await waitAi(page, site, true, 12_000);
      log(`video "${q}" start:`, JSON.stringify(first));
      if (!aiShown(first)) {
        await sleep(10_000);
        continue;
      }
      await page.waitForTimeout(2000); // overview finishes streaming
      await caption(false);
      await page.mouse.move(W - 5, H - 60);
      await page.waitForTimeout(300);
      trimStart = (Date.now() - t0) / 1000;
      await page.waitForTimeout(3000);
      ok = (await flip(true, 4000)) && (await flip(false, 3000)) && (await flip(true, 3000));
      length = (Date.now() - t0) / 1000 - trimStart;
    } finally {
      await context.close(); // finishes the video file
    }
    if (!ok) {
      log(`video "${q}": the sequence did not complete cleanly, discarding this take`);
      await sleep(15_000);
      continue;
    }
    // The context records every page; the search page is the largest file.
    const webm = readdirSync(dir)
      .filter((f) => f.endsWith('.webm'))
      .map((f) => ({ f: join(dir, f), size: statSync(join(dir, f)).size }))
      .sort((a, b) => b.size - a.size)[0]?.f;
    if (!webm) return null;
    mkdirSync(MEDIA, { recursive: true });
    const base = join(MEDIA, `aioff-${site.name}-demo`);
    const hasFfmpeg = spawnSync('which', ['ffmpeg']).status === 0;
    let out = `${base}.webm`;
    if (hasFfmpeg) {
      out = `${base}.mp4`;
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', trimStart.toFixed(2), '-i', webm, '-t', length.toFixed(2), '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '25', '-movflags', '+faststart', out]);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.5', '-i', out, '-frames:v', '1', `${base}-poster.png`]);
    } else {
      copyFileSync(webm, out);
    }
    rmSync(dir, { recursive: true, force: true });
    log(`video written: ${out} (${length.toFixed(1)}s, query "${q}")`);
    return { file: out, query: q };
  }
  rmSync(dir, { recursive: true, force: true });
  return null;
}

// ---------- run ----------
let query: string | null = queryArg ?? null;
if (!flag('video-only')) {
  query = await stills();
  if (query && !flag('shots-only')) await sleep(20_000); // be gentle with Google between runs
}
if (!flag('shots-only')) {
  let made = flag('bing') ? null : await video(GOOGLE, query ? [query, ...QUERIES.filter((x) => x !== query)].slice(0, 3) : QUERIES.slice(0, 2));
  if (!made) {
    log(flag('bing') ? 'recording on Bing' : 'Google recording did not work out; falling back to Bing');
    made = await video(BING, ['mario last name', 'why is the sky blue']);
  }
  if (!made) {
    log('no video produced');
    process.exitCode = 1;
  }
}
if (!flag('video-only') && !query) process.exitCode = 1;
