// Nightly health check. For each site with healthcheck entries: load the URL in a real
// browser, then evaluate every hide rule (selectors, then text anchors) inside the page.
// A rule is healthy when it matches at least once on at least one of the site's URLs.
//
//   pnpm healthcheck                     run all public sites, write healthcheck-report/report.json
//   pnpm healthcheck -- --site search-bing
//   pnpm healthcheck -- --capture        also save sanitized HTML fixtures under packages/rules/fixtures
//   pnpm healthcheck -- --locale de-DE   one locale (CI runs a matrix of locales and regions)
//
// Exit code 1 when any rule marked "expect" is broken, so CI can open issues. An "expect" list only counts
// in the locale it was baselined in (en-US unless the entry says otherwise); other locales still report
// what matched, which the issue opener uses as evidence that a rule is alive somewhere.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, type BrowserContext, type Page } from 'playwright';
import type { HideRule, Ruleset, Site } from '@aioff/core';
import { loadRuleset } from '@aioff/rules/load';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = join(ROOT, 'healthcheck-report');
const FIXTURES = join(ROOT, 'packages', 'rules', 'fixtures');
const locale = opt('locale') ?? 'en-US';
const onlySite = opt('site');
const capture = flag('capture');
const engine = opt('browser') === 'firefox' ? firefox : chromium;
const today = new Date().toISOString().slice(0, 10);

export interface RuleResult {
  ruleId: string;
  bySelector: number;
  byAnchor: number;
  matchedSelectors: string[];
}
export interface EntryResult {
  url: string;
  ok: boolean;
  error?: string;
  blocked?: string;
  rules: RuleResult[];
  screenshot?: string;
  fixture?: string;
}
export interface SiteResult {
  siteId: string;
  name: string;
  entries: EntryResult[];
  healthy: string[];
  broken: string[];
  unverifiable: boolean;
}

/** Per-site setup for consent walls. Cookies only; never logs in. */
async function setup(context: BrowserContext, site: Site): Promise<void> {
  if (site.id === 'search-google' || site.id === 'youtube') {
    await context.addCookies([
      { name: 'SOCS', value: 'CAI', domain: '.google.com', path: '/' },
      { name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' },
      { name: 'CONSENT', value: 'YES+', domain: '.google.com', path: '/' },
    ]);
  }
}

/** Runs inside the page. Mirrors core's matching: selectors first, anchors as a fallback report. */
function evaluateRules(rules: { id: string; selectors: string[]; textAnchors: string[] }[]) {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const texts: string[] = [];
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = (n.nodeValue ?? '').trim();
    const tag = n.parentElement?.tagName;
    if (t.length >= 3 && t.length < 120 && tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'NOSCRIPT') texts.push(t);
  }
  for (const el of Array.from(document.querySelectorAll('[aria-label]'))) texts.push((el.getAttribute('aria-label') ?? '').trim());
  return rules.map((r) => {
    let bySelector = 0;
    const matchedSelectors: string[] = [];
    for (const sel of r.selectors) {
      try {
        const c = document.querySelectorAll(sel).length;
        if (c) matchedSelectors.push(sel);
        bySelector += c;
      } catch {
        /* unsupported selector in this engine */
      }
    }
    let byAnchor = 0;
    if (r.textAnchors.length) {
      const re = new RegExp(`^(?:${r.textAnchors.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
      byAnchor = texts.filter((t) => re.test(t)).length;
    }
    return { ruleId: r.id, bySelector, byAnchor, matchedSelectors };
  });
}

/** Strip what tests do not need, so fixtures stay small and carry no tracking payloads. */
function sanitizeInPage(): string {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, style, noscript, link[rel="stylesheet"], link[rel="preload"], iframe, template, canvas, video, audio, source').forEach((e) => e.remove());
  clone.querySelectorAll('svg').forEach((e) => e.replaceChildren()); // not innerHTML: Trusted Types pages reject it
  clone.querySelectorAll('*').forEach((e) => {
    for (const a of Array.from(e.attributes)) {
      const v = a.value;
      if (a.name === 'style' || a.name === 'srcset' || a.name.startsWith('on')) e.removeAttribute(a.name);
      else if (v.startsWith('data:')) e.setAttribute(a.name, '');
      else if (v.length > 300) e.setAttribute(a.name, v.slice(0, 300));
    }
  });
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  let c: Node | null;
  while ((c = walker.nextNode())) comments.push(c);
  comments.forEach((x) => x.parentNode?.removeChild(x));
  return '<!doctype html>\n' + clone.outerHTML;
}

function detectBlock(title: string, bodyText: string, url: string): string | undefined {
  const t = `${title}\n${bodyText.slice(0, 2000)}`.toLowerCase();
  if (/\/sorry\/|captcha|unusual traffic|are you a robot|verify you are human|access denied|just a moment|press & hold|robot or human/.test(t + url)) return 'bot-wall';
  if (/sign in to continue|log in to continue|consent\.google|before you continue/.test(t + url)) return 'login-or-consent-wall';
  return undefined;
}

async function checkEntry(page: Page, site: Site, url: string): Promise<EntryResult> {
  const hideRules = site.rules.filter((r): r is HideRule => r.kind === 'hide' || r.kind === 'remove');
  const result: EntryResult = { url, ok: false, rules: [] };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2500); // late AI panels
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    result.blocked = detectBlock(title, bodyText, page.url());
    result.rules = await page.evaluate(
      evaluateRules,
      hideRules.map((r) => ({ id: r.id, selectors: r.selectors, textAnchors: r.textAnchors ?? [] })),
    );
    result.ok = !result.blocked;
    const slug = `${site.id}-${Buffer.from(url).toString('base64url').slice(-10)}`;
    mkdirSync(join(OUT, 'screens'), { recursive: true });
    result.screenshot = join('screens', `${slug}.png`);
    await page.screenshot({ path: join(OUT, result.screenshot), fullPage: false }).catch(() => {});
    if (capture && result.ok) {
      const html = await page.evaluate(sanitizeInPage);
      const dir = join(FIXTURES, site.id);
      mkdirSync(dir, { recursive: true });
      const matched = result.rules.filter((r) => r.bySelector + r.byAnchor > 0).map((r) => r.ruleId);
      const name = `${today}-${locale}-${slug.slice(-6)}`;
      writeFileSync(join(dir, `${name}.html`), html);
      writeFileSync(join(dir, `${name}.json`), JSON.stringify({ kind: 'captured', url, locale, capturedAt: new Date().toISOString(), expect: matched }, null, 2) + '\n');
      result.fixture = `${site.id}/${name}.html`;
    }
  } catch (e) {
    result.error = String((e as Error).message ?? e).split('\n')[0];
  }
  return result;
}

async function main() {
  const ruleset: Ruleset = loadRuleset();
  const sites = ruleset.sites.filter((s) => (onlySite ? s.id === onlySite : true) && s.healthcheck?.entries.length && !s.healthcheck.requiresLogin);
  mkdirSync(OUT, { recursive: true });
  const browser = await engine.launch({ headless: !flag('headed') });
  const results: SiteResult[] = [];
  for (const site of sites) {
    const context = await browser.newContext({
      locale,
      viewport: { width: 1366, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    });
    // tsx (esbuild keepNames) wraps functions in __name(); define it in the page so page.evaluate works.
    await context.addInitScript('globalThis.__name = (f) => f;');
    await setup(context, site);
    const page = await context.newPage();
    const entries: EntryResult[] = [];
    for (const entry of site.healthcheck!.entries) {
      if (entry.locale && entry.locale !== locale) continue;
      entries.push(await checkEntry(page, site, entry.url));
    }
    await context.close();
    const hideIds = site.rules.filter((r) => r.kind === 'hide' || r.kind === 'remove').map((r) => r.id);
    const healthy = hideIds.filter((id) => entries.some((e) => e.rules.some((r) => r.ruleId === id && r.bySelector + r.byAnchor > 0)));
    // "expect" lists come from a baseline run in one locale (en-US unless the entry names one). Sites serve
    // their AI surfaces per locale, so a miss in another locale is information, never a broken rule.
    const expected = new Set(site.healthcheck!.entries.filter((e) => (e.locale ?? 'en-US') === locale).flatMap((e) => e.expect ?? []));
    const unverifiable = entries.length > 0 && entries.every((e) => !e.ok);
    const broken = unverifiable ? [] : [...expected].filter((id) => !healthy.includes(id));
    results.push({ siteId: site.id, name: site.name, entries, healthy, broken, unverifiable });
    const status = unverifiable ? 'UNVERIFIABLE' : broken.length ? 'BROKEN' : 'ok';
    console.log(`${status.padEnd(13)} ${site.id.padEnd(24)} healthy ${healthy.length}/${hideIds.length}${broken.length ? '  broken: ' + broken.join(', ') : ''}${unverifiable ? '  (' + (entries[0]?.blocked ?? entries[0]?.error ?? '') + ')' : ''}`);
  }
  await browser.close();
  const report = { rulesVersion: ruleset.version, locale, browser: engine.name(), ranAt: new Date().toISOString(), results };
  writeFileSync(join(OUT, `report-${locale}.json`), JSON.stringify(report, null, 2));
  const brokenTotal = results.reduce((n, r) => n + r.broken.length, 0);
  console.log(`\n${results.length} sites, ${brokenTotal} broken expected rules, ${results.filter((r) => r.unverifiable).length} unverifiable`);
  process.exit(brokenTotal ? 1 : 0);
}

void main();
