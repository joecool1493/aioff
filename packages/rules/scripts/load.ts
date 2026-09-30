// Assembles the ruleset from the per-file sources under src/. Shared by the build and the tests.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NetworkRule, Rule, Ruleset, Site } from '@aioff/core';

export const RULES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(RULES_ROOT, 'src');

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

export function loadSites(): Site[] {
  const dir = join(SRC, 'sites');
  const order = readJson<string[]>(join(SRC, 'site-order.json'));
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const sites = files.map((f) => {
    const site = readJson<Site>(join(dir, f));
    // "x" holds source-only notes (confidence, where a selector came from). It never ships.
    site.rules = site.rules.map((r) => {
      const { x: _x, ...rest } = r as Rule & { x?: unknown };
      return rest as Rule;
    });
    return site;
  });
  const rank = (id: string) => (order.indexOf(id) === -1 ? order.length : order.indexOf(id));
  return sites.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

export function pruneExpired(sites: Site[], today: string): Site[] {
  return sites
    .map((s) => ({ ...s, rules: s.rules.filter((r) => !r.until || r.until >= today) }))
    .filter((s) => s.rules.length > 0);
}

interface DomainSource {
  products: { domain: string; blackout: boolean }[];
  adsTracking: { domain: string }[];
}

/** network.json names a tier; the domains themselves live in packages/dns (one source of truth). */
export function loadNetwork(): NetworkRule[] {
  const shells = readJson<(Omit<NetworkRule, 'domains'> & { tier: keyof DomainSource })[]>(join(SRC, 'network.json'));
  const domains = readJson<DomainSource>(join(RULES_ROOT, '..', 'dns', 'src', 'domains.json'));
  return shells.map(({ tier, ...shell }) => ({
    ...shell,
    domains:
      tier === 'products'
        ? domains.products.filter((p) => p.blackout).map((p) => p.domain)
        : domains.adsTracking.map((p) => p.domain),
  }));
}

export function loadRuleset(opts: { version?: string; today?: string } = {}): Ruleset {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const meta = readJson<{ minExtensionVersion: string }>(join(SRC, 'meta.json'));
  const [y, m, d] = today.split('-').map(Number);
  return {
    version: opts.version ?? `${y}.${m}.${d}.${process.env.RULES_BUILD_NUMBER ?? '1'}`,
    minExtensionVersion: meta.minExtensionVersion,
    hostGroups: readJson(join(SRC, 'host-groups.json')),
    sites: pruneExpired(loadSites(), today),
    network: loadNetwork(),
    mute: readJson(join(SRC, 'mute.json')),
    provenance: readJson(join(SRC, 'provenance.json')),
  };
}
