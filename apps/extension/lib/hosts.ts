// Host permissions and content script matches, derived from the embedded ruleset at build time.
import type { Ruleset } from '@aioff/core';
import { expandPattern, toHostPermission } from '@aioff/core';
import rulesetJson from '@aioff/rules';

const ruleset = rulesetJson as unknown as Ruleset;

/** Hosts with their own mute containers also get the content script (Level 2). */
function muteHostPatterns(): string[] {
  return Object.keys(ruleset.mute.containers).map((h) => `*://*.${h}/*`);
}

export function adapterMatches(): string[] {
  const out = new Set<string>();
  for (const site of ruleset.sites) {
    if (site.generic) continue;
    for (const pattern of site.match) {
      for (const p of expandPattern(pattern, ruleset.hostGroups)) out.add(toHostPermission(p));
    }
  }
  for (const p of muteHostPatterns()) out.add(p);
  return [...out].sort();
}
