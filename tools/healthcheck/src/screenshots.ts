// Store screenshots (1280x800) from the real built extension on live pages, plus the popup and
// options composited over a real page. Output: docs/store/. Run after `pnpm ext:build`.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EXT = join(ROOT, 'apps', 'extension', '.output', 'chrome-mv3');
const OUT = join(ROOT, 'docs', 'store');
mkdirSync(OUT, { recursive: true });
const W = 1280;
const H = 800;

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'aioff-shots-')), {
  channel: 'chromium',
  headless: true,
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
try {
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extId = new URL(sw.url()).host;
  await new Promise((r) => setTimeout(r, 1500));
  const setSettings = (patch: Record<string, unknown>) =>
    sw!.evaluate(async (p: Record<string, unknown>) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, ...p } });
    }, patch);

  const page = await context.newPage();
  const bing = 'https://www.bing.com/search?q=mario+last+name&setlang=en-US&cc=US';

  // 1. Before: switch off (AI on).
  await setSettings({ enabled: false, level: 1 });
  await page.goto(bing, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, '01-bing-before.png') });

  // 2. After: switch on.
  await setSettings({ enabled: true, level: 1 });
  await page.goto(bing, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, '02-bing-after.png') });

  // 3. Level 2 on Hacker News.
  await setSettings({ enabled: true, level: 2 });
  await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, '03-hn-level2.png') });

  // 4. Popup and options, standalone (composited in docs/store/compose.py).
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 660 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForTimeout(800);
  await popup.screenshot({ path: join(OUT, 'popup-raw.png') });
  await popup.close();

  const options = await context.newPage();
  await options.setViewportSize({ width: W, height: H });
  await options.goto(`chrome-extension://${extId}/options.html`);
  await options.waitForTimeout(600);
  await options.locator('button[role="tab"]', { hasText: 'Rules' }).click();
  await options.waitForTimeout(300);
  await options.locator('details.site summary').first().click();
  await options.waitForTimeout(300);
  await options.screenshot({ path: join(OUT, '05-options-rules.png') });
  await options.close();
  console.log('screenshots written to docs/store');
} finally {
  await context.close();
}
