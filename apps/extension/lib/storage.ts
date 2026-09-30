import { browser } from 'wxt/browser';
import type { ManagedConfig, ProState, Ruleset, Settings, StatsStore } from '@aioff/core';
import { DEFAULT_PRO, DEFAULT_SETTINGS, EMPTY_STATS, sanitizeSettings } from '@aioff/core';

export interface FeedStatus {
  version: string;
  source: 'embedded' | 'remote';
  checkedAt: number | null;
  updatedAt: number | null;
  lastError: string | null;
}

export interface ListsStore {
  fetchedAt: number | null;
  domainLines: string[];
  channelLines: string[];
}

export interface StoreShape {
  settings: Settings;
  ruleset: Ruleset | null;
  feed: FeedStatus | null;
  stats: StatsStore;
  managed: ManagedConfig | null;
  managedRemote: ManagedConfig | null;
  lists: ListsStore | null;
  clicked: Record<string, number>;
  pro: ProState;
}

const DEFAULTS: StoreShape = {
  settings: DEFAULT_SETTINGS,
  ruleset: null,
  feed: null,
  stats: EMPTY_STATS,
  managed: null,
  managedRemote: null,
  lists: null,
  clicked: {},
  pro: DEFAULT_PRO,
};

export async function getStore<K extends keyof StoreShape>(...keys: K[]): Promise<Pick<StoreShape, K>> {
  const raw = await browser.storage.local.get(keys as string[]);
  const out = {} as Pick<StoreShape, K>;
  for (const k of keys) {
    const v = raw[k as string];
    out[k] = (
      k === 'settings'
        ? sanitizeSettings(v) // defaults for missing fields, repairs for mistyped ones (older versions, imports, sync)
        : k === 'pro'
          ? { ...DEFAULT_PRO, ...(v as object | undefined), sync: { ...DEFAULT_PRO.sync, ...((v as ProState | undefined)?.sync ?? {}) } }
          : (v ?? DEFAULTS[k])
    ) as StoreShape[K];
  }
  return out;
}

export async function setStore(patch: Partial<StoreShape>): Promise<void> {
  await browser.storage.local.set(patch as Record<string, unknown>);
}

export async function updateSettings(fn: (s: Settings) => Settings): Promise<Settings> {
  const { settings } = await getStore('settings');
  const next = fn(settings);
  await setStore({ settings: next });
  return next;
}

/** Merge static managed policy with the optional hosted org config. Hosted values win. */
export function mergeManaged(a: ManagedConfig | null, b: ManagedConfig | null): ManagedConfig | null {
  if (!a && !b) return null;
  return { ...(a ?? {}), ...(b ?? {}), orgName: a?.orgName ?? b?.orgName, configUrl: a?.configUrl };
}

export type Message =
  | { type: 'count'; increments: { siteId: string; ruleId: string; n: number }[] }
  | { type: 'insertCss'; css: string }
  | { type: 'removeCss'; css: string }
  | { type: 'startPicker'; tabId: number }
  | { type: 'saveUserRule'; host: string; selector: string; note?: string }
  | { type: 'checkFeedNow' }
  | { type: 'allSitesChanged' }
  | { type: 'syncNow'; direction: 'push' | 'pull' };
