// Settings hygiene. Settings arrive from three sources whose shape cannot be trusted: a backup file the
// user imports, a sync blob written by another device (possibly by another version of the extension),
// and storage written by an older version of this extension. Every reader goes through sanitizeSettings,
// so a missing or mistyped field falls back to its default instead of breaking every content script.

import { DEFAULT_SETTINGS, type Level, type Settings, type UserRule } from './types.ts';

const MAX_LIST = 5000;
const MAX_ITEM = 512;
const MAX_SELECTOR = 2000;

function stringList(v: unknown, map: (s: string) => string = (s) => s): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = map(item.trim());
    if (s && s.length <= MAX_ITEM) out.add(s);
    if (out.size >= MAX_LIST) break;
  }
  return [...out];
}

const lowerHost = (s: string) => s.toLowerCase();

/** A user rule's selector goes straight into a stylesheet, so it may not close the block, and it may never target the page itself. */
export function isSafeSelector(selector: string): boolean {
  const s = selector.trim();
  return s.length > 0 && s.length <= MAX_SELECTOR && !/[{};]/.test(s) && !/^(html|body|main|head|\*)$/i.test(s);
}

function userRules(v: unknown, today: string): UserRule[] {
  if (!Array.isArray(v)) return [];
  const out: UserRule[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.host !== 'string' || typeof r.selector !== 'string') continue;
    const host = r.host.trim().toLowerCase();
    const selector = r.selector.trim();
    if (!host || host.length > MAX_ITEM || !isSafeSelector(selector)) continue;
    if (out.some((x) => x.host === host && x.selector === selector)) continue;
    const created = typeof r.created === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.created) ? r.created : today;
    const note = typeof r.note === 'string' ? r.note.trim().slice(0, MAX_ITEM) : '';
    out.push({ host, selector, created, ...(note ? { note } : {}) });
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

/** Coerce anything into a valid Settings object. Unknown fields are dropped; wrong-typed fields take their default. */
export function sanitizeSettings(input: unknown, now = new Date()): Settings {
  const src = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const lvl = Number(src.level);
  const level: Level = lvl === 1 || lvl === 2 || lvl === 3 || lvl === 4 ? lvl : DEFAULT_SETTINGS.level;
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_SETTINGS.enabled,
    level,
    pausedSites: stringList(src.pausedSites, lowerHost),
    pauseUntil: typeof src.pauseUntil === 'number' && Number.isFinite(src.pauseUntil) && src.pauseUntil > 0 ? src.pauseUntil : null,
    disabledRules: stringList(src.disabledRules),
    enabledOptionalRules: stringList(src.enabledOptionalRules),
    userMuteTerms: stringList(src.userMuteTerms),
    disabledFeedTerms: stringList(src.disabledFeedTerms),
    userRules: userRules(src.userRules, now.toISOString().slice(0, 10)),
    provenanceMode: src.provenanceMode === 'badge' ? 'badge' : DEFAULT_SETTINGS.provenanceMode,
    sound: typeof src.sound === 'boolean' ? src.sound : DEFAULT_SETTINGS.sound,
    showSupportChat: stringList(src.showSupportChat, lowerHost),
  };
}
