// Match patterns. Same shape as WebExtension match patterns, plus one extension:
// a host may end in ".*" (example: "www.google.*"), which is expanded through the
// ruleset's hostGroups so a wildcard TLD can never match a lookalike domain.

export interface ParsedPattern {
  scheme: string;
  host: string;
  path: string;
}

export function parsePattern(pattern: string): ParsedPattern | null {
  if (pattern === '<all_urls>') return { scheme: '*', host: '*', path: '/*' };
  const m = /^(\*|https?|wss?):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!m) return null;
  return { scheme: m[1]!, host: m[2]!, path: m[3]! };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRe(glob: string): string {
  return glob.split('*').map(escapeRe).join('.*');
}

/** "www.google.*" gives "google.*"; "*.google.*" gives "google.*". */
export function groupKeyOf(host: string): string | null {
  if (!host.endsWith('.*')) return null;
  const bare = host.replace(/^\*\./, '');
  const parts = bare.split('.');
  // the label right before the wildcard TLD names the group
  return `${parts[parts.length - 2]}.*`;
}

function hostMatches(patternHost: string, hostname: string, hostGroups: Record<string, string[]>): boolean {
  if (patternHost === '*') return true;
  const key = groupKeyOf(patternHost);
  if (key) {
    const group = hostGroups[key];
    if (!group) return false;
    const wildcardSub = patternHost.startsWith('*.');
    const prefix = patternHost.replace(/^\*\./, '').slice(0, -2); // "www.google" or "google"
    const base = key.slice(0, -2); // "google"
    const sub = prefix === base ? '' : prefix.slice(0, prefix.length - base.length); // "www."
    return group.some((domain) => {
      const full = sub + domain;
      if (hostname === full) return true;
      return wildcardSub && hostname.endsWith('.' + full);
    });
  }
  if (patternHost.startsWith('*.')) {
    const bare = patternHost.slice(2);
    return hostname === bare || hostname.endsWith('.' + bare);
  }
  return hostname === patternHost;
}

export function matchesPattern(pattern: string, url: URL, hostGroups: Record<string, string[]> = {}): boolean {
  const p = parsePattern(pattern);
  if (!p) return false;
  const scheme = url.protocol.slice(0, -1);
  if (p.scheme === '*') {
    if (scheme !== 'http' && scheme !== 'https') return false;
  } else if (p.scheme !== scheme) return false;
  if (!hostMatches(p.host, url.hostname, hostGroups)) return false;
  const pathRe = new RegExp('^' + globToRe(p.path) + '$');
  return pathRe.test(url.pathname + url.search);
}

export function matchesAny(patterns: string[] | undefined, url: URL, hostGroups: Record<string, string[]> = {}): boolean {
  return !!patterns && patterns.some((p) => matchesPattern(p, url, hostGroups));
}

/**
 * Expand a pattern into plain WebExtension match patterns (no wildcard TLDs),
 * suitable for manifest host_permissions and content script matches.
 */
export function expandPattern(pattern: string, hostGroups: Record<string, string[]>): string[] {
  const p = parsePattern(pattern);
  if (!p) return [];
  const key = groupKeyOf(p.host);
  if (!key) return [pattern];
  const group = hostGroups[key] ?? [];
  const wildcardSub = p.host.startsWith('*.');
  const prefix = p.host.replace(/^\*\./, '').slice(0, -2);
  const base = key.slice(0, -2);
  const sub = prefix === base ? '' : prefix.slice(0, prefix.length - base.length);
  return group.map((domain) => `${p.scheme}://${wildcardSub ? '*.' : ''}${sub}${domain}${p.path}`);
}

/** Host part only, for host_permissions: "*://www.google.de/*". */
export function toHostPermission(pattern: string): string {
  const p = parsePattern(pattern);
  if (!p) return pattern;
  return `${p.scheme}://${p.host}/*`;
}

/**
 * RE2 compatible regex (no lookarounds) for declarativeNetRequest regexFilter.
 * DNR caps compiled regex memory, so a wildcard TLD group is NOT expanded into a huge
 * alternation. The regex accepts any TLD and the caller pairs it with requestDomains,
 * which pins the rule to the real domains of the group.
 */
export function patternToRe2(
  pattern: string,
  hostGroups: Record<string, string[]>,
  pathPrefix?: string,
): { regex: string; requestDomains?: string[] } | null {
  const p = parsePattern(pattern);
  if (!p) return null;
  const scheme = p.scheme === '*' ? 'https?' : escapeRe(p.scheme);
  let host: string;
  let requestDomains: string[] | undefined;
  const key = groupKeyOf(p.host);
  if (p.host === '*') host = '[^/]+';
  else if (key) {
    const group = hostGroups[key] ?? [];
    if (!group.length) return null;
    const prefix = p.host.replace(/^\*\./, '').slice(0, -2);
    host = `${p.host.startsWith('*.') ? '([^/]+\\.)?' : ''}${escapeRe(prefix)}\\.[a-z.]+`;
    requestDomains = group;
  } else if (p.host.startsWith('*.')) host = `([^/]+\\.)?${escapeRe(p.host.slice(2))}`;
  else host = escapeRe(p.host);
  const path = pathPrefix != null ? escapeRe(pathPrefix) : globToRe(p.path).replace(/\.\*$/, '');
  return { regex: `^${scheme}://${host}${path}`, ...(requestDomains ? { requestDomains } : {}) };
}

/** True when host equals domain or is a subdomain of it. */
export function hostIsOrUnder(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain);
}
