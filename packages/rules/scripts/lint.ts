// Checks the JSON Schema cannot express. Used by the build and the test suite.
import type { Ruleset } from '@aioff/core';
import { parsePattern, groupKeyOf } from '@aioff/core';

export interface Problem {
  severity: 'error' | 'warn';
  message: string;
}

// Domains that must never be blocked at the network layer: blocking them breaks
// far more than AI. Blackout targets AI product hosts only.
export const NEVER_BLOCK = [
  'google.com', 'bing.com', 'microsoft.com', 'live.com', 'office.com', 'github.com', 'x.com', 'twitter.com',
  'facebook.com', 'instagram.com', 'whatsapp.com', 'apple.com', 'icloud.com', 'amazon.com', 'youtube.com',
  'linkedin.com', 'reddit.com', 'duckduckgo.com', 'brave.com', 'mozilla.org', 'cloudflare.com', 'adobe.com',
];

const EM_DASH = String.fromCharCode(0x2014);

export function lintRuleset(ruleset: Ruleset): Problem[] {
  const problems: Problem[] = [];
  const err = (message: string) => problems.push({ severity: 'error', message });
  const warn = (message: string) => problems.push({ severity: 'warn', message });

  const ids = new Set<string>();
  const claim = (id: string, where: string) => {
    if (ids.has(id)) err(`duplicate id "${id}" (${where})`);
    ids.add(id);
  };
  for (const site of ruleset.sites) {
    claim(site.id, 'site');
    for (const pattern of [...site.match, ...(site.excludeMatch ?? [])]) {
      const p = parsePattern(pattern);
      if (!p) {
        err(`${site.id}: bad match pattern ${pattern}`);
        continue;
      }
      const key = groupKeyOf(p.host);
      if (key && !ruleset.hostGroups[key]) err(`${site.id}: pattern ${pattern} needs hostGroups["${key}"]`);
      if (p.host === '*' && !site.generic) err(`${site.id}: broad match requires "generic": true`);
    }
    for (const rule of site.rules) {
      claim(rule.id, `rule in ${site.id}`);
      if (rule.description.includes(EM_DASH)) err(`${rule.id}: no em dashes in copy`);
      if (rule.kind === 'hide' || rule.kind === 'remove') {
        for (const sel of rule.selectors) {
          const bare = sel.trim();
          if (/^(html|body|main|\*|div|span|section|article)$/i.test(bare)) err(`${rule.id}: selector "${sel}" is far too broad`);
          if (/\{|\}|;/.test(sel)) err(`${rule.id}: selector "${sel}" contains CSS block characters`);
        }
        if (!rule.selectors.length && !rule.textAnchors?.length) err(`${rule.id}: needs a selector or a text anchor`);
        if (site.generic && rule.kind === 'remove') err(`${rule.id}: generic sites may only hide, never remove`);
      }
      if (!rule.since) warn(`${rule.id}: missing "since" date`);
    }
    if (!site.healthcheck?.entries.length && !site.healthcheck?.requiresLogin && !site.generic) warn(`${site.id}: no healthcheck entry`);
  }
  for (const n of ruleset.network) {
    claim(n.id, 'network');
    for (const d of n.domains) {
      if (NEVER_BLOCK.includes(d)) err(`${n.id}: ${d} is on the never-block list`);
    }
  }
  for (const d of ruleset.mute.ads.landingDomains) {
    if (NEVER_BLOCK.includes(d)) err(`mute.ads: ${d} is on the never-block list`);
  }
  return problems;
}
