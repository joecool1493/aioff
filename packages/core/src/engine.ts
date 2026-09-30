import { hostIsOrUnder, matchesAny } from './match.ts';
import type {
  ClickRule,
  HideRule,
  Level,
  ManagedConfig,
  MuteContainer,
  Rule,
  Ruleset,
  SetCookieRule,
  Settings,
  Site,
  UrlRewriteRule,
} from './types.ts';

/** Why AI Off is or is not acting on a page. */
export type ActiveState =
  | { active: true; level: Level }
  | { active: false; reason: 'switch-off' | 'paused-timer' | 'paused-site' | 'schedule' };

export function isLocked(managed: ManagedConfig | null | undefined): boolean {
  return !!managed && managed.locked !== false && Object.keys(managed).length > 0;
}

/** Managed config wins over user settings wherever it speaks. */
export function effectiveSettings(settings: Settings, managed?: ManagedConfig | null, now = Date.now()): Settings {
  if (!managed || Object.keys(managed).length === 0) return settings;
  const locked = isLocked(managed);
  const exam =
    !!managed.examMode?.enabled && (!managed.examMode.until || Date.parse(managed.examMode.until) > now);
  const level: Level = exam ? 4 : (managed.level ?? settings.level);
  return {
    ...settings,
    enabled: locked ? true : settings.enabled,
    level,
    pauseUntil: locked ? null : settings.pauseUntil,
    pausedSites: locked ? (exam ? [] : (managed.allowSites ?? [])) : [...settings.pausedSites, ...(managed.allowSites ?? [])],
    userMuteTerms: [...settings.userMuteTerms, ...(managed.muteExtraTerms ?? [])],
  };
}

export function inSchedule(managed: ManagedConfig | null | undefined, now = new Date()): boolean {
  const s = managed?.schedule;
  if (!s || s.alwaysOn !== false || !s.windows?.length) return true;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: s.timezone || 'UTC',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? '');
  const hhmm = `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`;
  return s.windows.some((w) => w.days.includes(day) && hhmm >= w.start && hhmm < w.end);
}

export function activeState(settings: Settings, hostname: string, now = Date.now()): ActiveState {
  if (!settings.enabled) return { active: false, reason: 'switch-off' };
  if (settings.pauseUntil && settings.pauseUntil > now) return { active: false, reason: 'paused-timer' };
  if (settings.pausedSites.some((h) => hostIsOrUnder(hostname, h))) return { active: false, reason: 'paused-site' };
  return { active: true, level: settings.level };
}

export function ruleEnabled(rule: Rule, site: Site, settings: Settings): boolean {
  const level = rule.level ?? site.level;
  if (level > settings.level) return false;
  if (settings.disabledRules.includes(rule.id)) return false;
  if (rule.defaultEnabled === false && !settings.enabledOptionalRules.includes(rule.id)) return false;
  return true;
}

export interface ResolvedHide {
  ruleId: string;
  siteId: string;
  description: string;
  kind: 'hide' | 'remove';
  selectors: string[];
  textAnchors: string[];
  anchorTarget: 'block' | 'control' | 'self';
  anchorContainer?: string;
  anchorScope?: string[];
  hideClosest?: string;
}

export interface ResolvedPage {
  siteIds: string[];
  hide: ResolvedHide[];
  urlRewrites: (UrlRewriteRule & { siteId: string })[];
  cookies: (SetCookieRule & { siteId: string })[];
  clicks: (ClickRule & { siteId: string })[];
  muteContainers: MuteContainer[];
  muteGeneric: boolean;
}

export function sitesForUrl(ruleset: Ruleset, url: URL): Site[] {
  return ruleset.sites.filter(
    (s) => matchesAny(s.match, url, ruleset.hostGroups) && !matchesAny(s.excludeMatch, url, ruleset.hostGroups),
  );
}

export function muteContainersForHost(ruleset: Ruleset, hostname: string): MuteContainer[] | null {
  for (const [host, containers] of Object.entries(ruleset.mute.containers)) {
    if (hostIsOrUnder(hostname, host)) return containers;
  }
  return null;
}

/** Everything the content script needs for one page. Pure, no DOM. */
export function resolvePage(ruleset: Ruleset, url: URL, settings: Settings): ResolvedPage {
  const page: ResolvedPage = {
    siteIds: [],
    hide: [],
    urlRewrites: [],
    cookies: [],
    clicks: [],
    muteContainers: [],
    muteGeneric: false,
  };
  for (const site of sitesForUrl(ruleset, url)) {
    page.siteIds.push(site.id);
    const chatShown =
      site.id === 'generic-chat-widgets' && settings.showSupportChat.some((h) => hostIsOrUnder(url.hostname, h));
    if (chatShown) continue;
    for (const rule of site.rules) {
      if (!ruleEnabled(rule, site, settings)) continue;
      switch (rule.kind) {
        case 'hide':
        case 'remove': {
          const r = rule as HideRule;
          page.hide.push({
            ruleId: r.id,
            siteId: site.id,
            description: r.description,
            kind: r.kind,
            selectors: r.selectors,
            textAnchors: r.textAnchors ?? [],
            anchorTarget: r.anchorTarget ?? 'block',
            anchorContainer: r.anchorContainer,
            anchorScope: r.anchorScope,
            hideClosest: r.hideClosest,
          });
          break;
        }
        case 'urlRewrite':
          page.urlRewrites.push({ ...rule, siteId: site.id });
          break;
        case 'setCookie':
          page.cookies.push({ ...rule, siteId: site.id });
          break;
        case 'click':
          page.clicks.push({ ...rule, siteId: site.id });
          break;
      }
    }
  }
  for (const ur of settings.userRules) {
    if (!hostIsOrUnder(url.hostname, ur.host)) continue;
    page.hide.push({
      ruleId: `user:${ur.host}:${ur.selector}`,
      siteId: 'user',
      description: ur.note || 'A rule you made with the element picker',
      kind: 'hide',
      selectors: [ur.selector],
      textAnchors: [],
      anchorTarget: 'block',
    });
  }
  if (settings.level >= ruleset.mute.level) {
    const containers = muteContainersForHost(ruleset, url.hostname);
    if (containers) page.muteContainers = containers;
    else {
      page.muteContainers = ruleset.mute.genericContainers;
      page.muteGeneric = true;
    }
  }
  return page;
}

/** Selectors that can go in a static stylesheet: plain hide rules with no closest() hop. */
export function buildHideCss(hide: ResolvedHide[]): string {
  const blocks: string[] = [];
  for (const h of hide) {
    if (h.hideClosest || !h.selectors.length) continue;
    // One block per rule: a selector the browser cannot parse only voids its own rule.
    for (const sel of h.selectors) blocks.push(`${sel}{display:none!important}`);
  }
  blocks.push('[data-aioff-hidden]{display:none!important}');
  return blocks.join('\n');
}

/** Compute the rewritten URL for a urlRewrite rule, or null when nothing changes. */
export function applyUrlRewrite(rule: UrlRewriteRule, url: URL): URL | null {
  const missing = rule.when?.paramMissing;
  const missingList = missing == null ? [] : Array.isArray(missing) ? missing : [missing];
  if (missingList.some((p) => url.searchParams.has(p))) return null;
  if (rule.when?.pathPrefix && !(url.pathname + url.search).startsWith(rule.when.pathPrefix)) return null;
  const next = new URL(url.href);
  let changed = false;
  for (const [k, v] of Object.entries(rule.set ?? {})) {
    if (next.searchParams.get(k) !== v) {
      next.searchParams.set(k, v);
      changed = true;
    }
  }
  for (const k of rule.remove ?? []) {
    if (next.searchParams.has(k)) {
      next.searchParams.delete(k);
      changed = true;
    }
  }
  return changed ? next : null;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
