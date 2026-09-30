// One domain source, many formats. Tiers:
//   ads       AI companies' ad, analytics, and telemetry hosts. Safe for everyone.
//   products  AI chatbots, generators, and APIs. Blackout (Level 4) only: this breaks things on purpose.
// The "slop" tier (AI content farms) is not a DNS list here: it is a community list consumed
// by the extension, because blocking whole content sites at DNS is too blunt for a default.

import source from './domains.json' with { type: 'json' };

export interface DomainEntry {
  domain: string;
  company: string;
  category: string;
  blackout?: boolean;
}
export type Tier = 'ads' | 'products';

const data = source as unknown as { products: DomainEntry[]; adsTracking: DomainEntry[]; neverBlock: { domain: string; reason: string }[] };

export const neverBlock = (): string[] => data.neverBlock.map((n) => n.domain);

export function tier(t: Tier): DomainEntry[] {
  const list = t === 'ads' ? data.adsTracking : data.products.filter((p) => p.blackout !== false);
  return [...list].sort((a, b) => a.domain.localeCompare(b.domain));
}

/** A listed domain may never equal a never-block domain or be a parent of one. */
export function guardViolations(): string[] {
  const never = neverBlock();
  const out: string[] = [];
  for (const e of [...data.products, ...data.adsTracking]) {
    for (const n of never) if (e.domain === n || n.endsWith('.' + e.domain)) out.push(`${e.domain} would block ${n}`);
  }
  return out;
}

/** Drop entries already covered by a listed parent (formats that match subdomains do not need them). */
export function dedupeSubdomains(domains: string[]): string[] {
  const set = new Set(domains);
  return domains.filter((d) => {
    const labels = d.split('.');
    for (let i = 1; i < labels.length - 1; i++) if (set.has(labels.slice(i).join('.'))) return false;
    return true;
  });
}

const header = (t: Tier, comment: string, version: string) =>
  [
    `${comment} Title: AI Off ${t === 'ads' ? 'AI ads and tracking' : 'Blackout (AI products)'}`,
    `${comment} Homepage: https://aioff.app`,
    `${comment} License: MIT`,
    `${comment} Version: ${version}`,
    t === 'products' ? `${comment} WARNING: this list blocks AI chatbots and generators on purpose. It will break AI tools you may use.` : '',
  ].filter(Boolean);

export type Format = 'hosts' | 'adguard' | 'domains' | 'dnsmasq' | 'unbound' | 'rpz' | 'blocky' | 'controld' | 'littlesnitch' | 'csv';

export function render(t: Tier, format: Format, version: string): string {
  const entries = tier(t);
  const all = entries.map((e) => e.domain);
  const roots = dedupeSubdomains(all);
  switch (format) {
    case 'hosts':
      return [...header(t, '#', version), ...all.map((d) => `0.0.0.0 ${d}`), ''].join('\n');
    case 'adguard':
      return [`! Title: AI Off ${t}`, ...header(t, '!', version).slice(1), ...roots.map((d) => `||${d}^`), ''].join('\n');
    case 'domains': // Pi-hole, NextDNS denylist paste, Cloudflare Gateway list, most school filters
      return [...header(t, '#', version), ...roots, ''].join('\n');
    case 'dnsmasq':
      return [...header(t, '#', version), ...roots.map((d) => `address=/${d}/`), ''].join('\n');
    case 'unbound':
      return [...header(t, '#', version), 'server:', ...roots.map((d) => `  local-zone: "${d}." always_nxdomain`), ''].join('\n');
    case 'rpz':
      return [
        ...header(t, ';', version),
        '$TTL 300',
        '@ IN SOA localhost. root.localhost. 1 3600 600 86400 300',
        '  IN NS localhost.',
        ...roots.flatMap((d) => [`${d} CNAME .`, `*.${d} CNAME .`]),
        '',
      ].join('\n');
    case 'blocky':
      return ['# blocky config snippet', 'blocking:', '  denylists:', `    aioff-${t}:`, '      - |', ...roots.map((d) => `        ${d}`), '  clientGroupsBlock:', '    default:', `      - aioff-${t}`, ''].join('\n');
    case 'controld': // folder import JSON; action 0 = block
      return JSON.stringify({ group: { group: `AI Off ${t}`, action: { do: 0, status: 1 } }, rules: roots.map((d) => ({ PK: d, action: { do: 0, status: 1 } })) }, null, 2) + '\n';
    case 'littlesnitch':
      return JSON.stringify({ name: `AI Off ${t}`, description: 'Blocks AI company domains. https://aioff.app', 'denied-remote-domains': roots }, null, 2) + '\n';
    case 'csv': // GoGuardian, Lightspeed, Securly, Linewize bulk import: one domain per row, wildcard form in column two
      return ['domain,wildcard,company,category', ...entries.map((e) => `${e.domain},*.${e.domain},"${e.company}",${e.category}`), ''].join('\n');
  }
}

export const FORMATS: { format: Format; file: string; for: string }[] = [
  { format: 'hosts', file: 'hosts.txt', for: 'hosts file, AdAway, Blokada' },
  { format: 'adguard', file: 'adguard.txt', for: 'AdGuard Home, AdGuard DNS (custom filter by URL), uBlock Origin' },
  { format: 'domains', file: 'domains.txt', for: 'Pi-hole, NextDNS denylist paste, Cloudflare Gateway list, most school web filters' },
  { format: 'dnsmasq', file: 'dnsmasq.conf', for: 'dnsmasq, OpenWrt' },
  { format: 'unbound', file: 'unbound.conf', for: 'Unbound, OPNsense, pfSense' },
  { format: 'rpz', file: 'rpz.zone', for: 'BIND, Knot, PowerDNS response policy zones' },
  { format: 'blocky', file: 'blocky.yml', for: 'blocky' },
  { format: 'controld', file: 'controld-folder.json', for: 'Control D custom folder import' },
  { format: 'littlesnitch', file: 'littlesnitch.lsrules', for: 'Little Snitch rule group subscription' },
  { format: 'csv', file: 'school-filter.csv', for: 'GoGuardian, Lightspeed, Securly, Linewize custom block lists' },
];
