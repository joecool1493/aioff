// Level 3: hide AI-made content. Three declared signals, no guessing:
//  1. Files that declare a generative digital source type (C2PA manifest or XMP).
//  2. Labels the platform itself puts on AI content.
//  3. Community lists of AI content farms and AI channels (uBlacklist format).
import {
  compileBlacklist,
  hostIsOrUnder,
  LABEL_ATTR,
  MUTED_ATTR,
  scanProvenance,
  type BlacklistMatcher,
  type CountFn,
  type ProvenanceVerdict,
  type Ruleset,
  type Settings,
} from '@aioff/core';
import type { ListsStore } from './storage';

const AI_MADE_ATTR = 'data-aioff-ai-made';
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PARALLEL = 3;

export const PROVENANCE_CSS = `
[${AI_MADE_ATTR}="hide"] { visibility: hidden !important; }
[${AI_MADE_ATTR}="badge"] { outline: 3px solid #d8442b !important; outline-offset: -3px !important; }
`;

export interface ProvenancePass {
  scan(root: ParentNode): void;
  revealAll(root: ParentNode): void;
}

// ---- verdict cache: IndexedDB, keyed by a hash of the URL, so scrolling back is instant ----
const DB_NAME = 'aioff-provenance';
const MAX_ENTRIES = 50_000;
let dbPromise: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('verdicts');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}
async function urlKey(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function cacheGet(key: string): Promise<ProvenanceVerdict | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    const req = d.transaction('verdicts').objectStore('verdicts').get(key);
    req.onsuccess = () => resolve((req.result as ProvenanceVerdict | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}
async function cachePut(key: string, verdict: ProvenanceVerdict): Promise<void> {
  const d = await db();
  if (!d) return;
  const store = d.transaction('verdicts', 'readwrite').objectStore('verdicts');
  store.put(verdict, key);
  const countReq = store.count();
  countReq.onsuccess = () => {
    if (countReq.result > MAX_ENTRIES) store.clear(); // crude cap; entries are a few bytes each
  };
}

export function createProvenancePass(opts: {
  ruleset: Ruleset;
  settings: Settings;
  lists: ListsStore | null;
  count: CountFn;
}): ProvenancePass {
  const { ruleset, settings, lists, count } = opts;
  const cfg = ruleset.provenance;
  const mode = settings.provenanceMode;
  const host = location.hostname;

  const domains: BlacklistMatcher = compileBlacklist([...cfg.starterDomains, ...(lists?.domainLines ?? [])]);
  const channels = new Set(
    [...cfg.starterYoutubeChannels, ...(lists?.channelLines ?? [])]
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith('#')),
  );
  const resultContainers = cfg.resultContainers.filter((r) => hostIsOrUnder(host, r.host) || host.includes(`.${r.host}.`) || host.startsWith(`${r.host}.`));
  const labels = cfg.platformLabels.filter((p) => hostIsOrUnder(host, p.host));
  const onYouTube = hostIsOrUnder(host, 'youtube.com');

  const seenImgs = new WeakSet<Element>();
  const queue: HTMLImageElement[] = [];
  let running = 0;

  const collapse = (el: Element, label: string, ruleId: string) => {
    if (el.hasAttribute(MUTED_ATTR)) return;
    el.setAttribute(MUTED_ATTR, ruleId);
    el.setAttribute(LABEL_ATTR, label);
    el.setAttribute('title', `AI Off: ${label}`);
    count('provenance', ruleId, 1);
  };

  async function verdictFor(url: string): Promise<ProvenanceVerdict> {
    const key = await urlKey(url);
    const cached = await cacheGet(key);
    if (cached) return cached;
    let verdict: ProvenanceVerdict = 'none';
    try {
      // force-cache: reuse the bytes the page already downloaded whenever the browser allows it
      const res = await fetch(url, { cache: 'force-cache', credentials: 'omit' });
      const len = Number(res.headers.get('content-length') ?? 0);
      if (res.ok && len <= MAX_BYTES) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length <= MAX_BYTES) verdict = scanProvenance(bytes, cfg.generativeSourceTypes, cfg.editedSourceTypes).verdict;
      }
    } catch {
      return 'none'; // CORS or network: skip silently and do not cache
    }
    await cachePut(key, verdict);
    return verdict;
  }

  function pump(): void {
    while (running < MAX_PARALLEL && queue.length) {
      const img = queue.shift()!;
      const url = img.currentSrc || img.src;
      if (!url || !/^https?:/.test(url)) continue;
      running++;
      verdictFor(url)
        .then((v) => {
          if (v === 'generated' || (v === 'edited' && mode === 'badge')) {
            img.setAttribute(AI_MADE_ATTR, v === 'generated' ? mode : 'badge');
            img.setAttribute('title', 'This file declares that it was made with generative AI (Content Credentials).');
            count('provenance', v === 'generated' ? 'c2pa-generated' : 'c2pa-edited', 1);
          }
        })
        .finally(() => {
          running--;
          pump();
        });
    }
  }

  return {
    scan(root: ParentNode): void {
      // 1. declared provenance in image files
      if (cfg.hideC2paGenerative) {
        for (const img of Array.from(root.querySelectorAll('img'))) {
          if (seenImgs.has(img)) continue;
          if (!img.complete || !img.naturalWidth) continue; // try again on a later pass
          seenImgs.add(img);
          if (img.naturalWidth * img.naturalHeight < cfg.minImagePixels) continue;
          queue.push(img);
        }
        pump();
      }
      // 2. platform labels
      for (const p of labels) {
        let containers: Element[] = [];
        try {
          containers = Array.from(root.querySelectorAll(p.container));
        } catch {
          continue;
        }
        for (const c of containers) {
          if (c.hasAttribute(MUTED_ATTR)) continue;
          let labeled = false;
          try {
            labeled = p.labelSelectors.some((s) => c.querySelector(s));
          } catch {
            /* ignore */
          }
          if (!labeled && p.textAnchors?.length) {
            const text = c.textContent ?? '';
            labeled = p.textAnchors.some((a) => text.includes(a));
          }
          if (labeled) collapse(c, 'AI-made content hidden: the platform labels it as AI (click to show)', 'platform-ai-label');
        }
      }
      // 3a. search results that point at listed AI content farms
      if (domains.size) {
        for (const r of resultContainers) {
          let items: Element[] = [];
          try {
            items = Array.from(root.querySelectorAll(r.container));
          } catch {
            continue;
          }
          for (const item of items) {
            if (item.hasAttribute(MUTED_ATTR)) continue;
            const link = item.querySelector<HTMLAnchorElement>('a[href^="http"]');
            const lpage = item.getAttribute('data-lpage');
            const target = lpage || link?.href;
            if (target && domains.blocks(target)) collapse(item, 'Result hidden: listed AI content site (click to show)', 'slop-domain');
          }
        }
      }
      // 3b. YouTube channels
      if (onYouTube && channels.size) {
        for (const item of Array.from(root.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model'))) {
          if (item.hasAttribute(MUTED_ATTR)) continue;
          const a = item.querySelector<HTMLAnchorElement>('a[href^="/@"], a[href^="/channel/"]');
          const handle = a?.getAttribute('href')?.split('/').filter(Boolean).slice(0, 2).join('/').toLowerCase();
          if (!handle) continue;
          const bare = handle.replace(/^channel\//, '');
          if (channels.has(bare) || channels.has('/' + handle) || channels.has(handle)) {
            collapse(item, 'Video hidden: listed AI channel (click to show)', 'ai-channel');
          }
        }
      }
    },
    revealAll(root: ParentNode): void {
      for (const el of Array.from(root.querySelectorAll(`[${AI_MADE_ATTR}]`))) el.removeAttribute(AI_MADE_ATTR);
    },
  };
}
