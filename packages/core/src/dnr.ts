// Compiles the ruleset into declarativeNetRequest rules. Pure data in, pure data out,
// so it can be unit tested without a browser.
//
// DNR regexFilter uses RE2, which has no lookahead. "Rewrite only when a param is
// missing" is expressed as two rules: a higher priority "allow" for URLs that already
// carry the param, and a lower priority redirect for the rest.

import { ruleEnabled } from './engine.ts';
import { patternToRe2 } from './match.ts';
import type { ManagedConfig, Ruleset, Settings, UrlRewriteRule } from './types.ts';

export interface DnrRule {
  id: number;
  priority: number;
  action: {
    type: 'block' | 'allow' | 'redirect' | 'allowAllRequests';
    redirect?: {
      transform?: { queryTransform?: { addOrReplaceParams?: { key: string; value: string }[]; removeParams?: string[] } };
      extensionPath?: string;
      regexSubstitution?: string;
    };
  };
  condition: {
    regexFilter?: string;
    urlFilter?: string;
    requestDomains?: string[];
    excludedRequestDomains?: string[];
    initiatorDomains?: string[];
    excludedInitiatorDomains?: string[];
    resourceTypes?: string[];
    excludedResourceTypes?: string[];
  };
}

const PRIORITY = { block: 10, blackoutNav: 11, rewrite: 20, rewriteSkip: 21, pause: 100 } as const;
const SUB_RESOURCE_TYPES = [
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'media',
  'websocket',
  'other',
];

export interface CompileOptions {
  /** Path of the extension page shown for Blackout navigations, e.g. "/blocked.html". */
  blockedPagePath?: string;
  /**
   * Absolute URL of that page (runtime.getURL). When set, the redirect carries the blocked URL as
   * ?u=<url>, so the page can send the visitor on to it after a pause. This form needs a regexFilter,
   * so it costs one regex rule per Blackout tier.
   */
  blockedPageUrl?: string;
  now?: number;
  managed?: ManagedConfig | null;
}

/** Domains a DNR condition accepts: lowercase, dotted, no scheme or path. One bad entry rejects the whole batch. */
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
export function validDomains(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const clean = list.filter((d): d is string => typeof d === 'string').map((d) => d.trim().toLowerCase()).filter((d) => DOMAIN_RE.test(d));
  return [...new Set(clean)];
}

/**
 * How a Blackout navigation is answered. With host access AI Off shows its own page, and the redirect carries
 * the blocked URL as ?u=<url> (regexSubstitution; \0 is the whole matched URL). Without host access a redirect
 * is not allowed, so the request is blocked and the browser shows its own page.
 */
function blackoutNavRule(id: number, domains: string[], resourceTypes: string[], opts: CompileOptions): DnrRule {
  const base = { id, priority: PRIORITY.blackoutNav };
  if (opts.blockedPageUrl) {
    return {
      ...base,
      action: { type: 'redirect', redirect: { regexSubstitution: `${opts.blockedPageUrl}?u=\\0` } },
      condition: { regexFilter: '^https?://.*', requestDomains: domains, resourceTypes },
    };
  }
  return {
    ...base,
    action: opts.blockedPagePath ? { type: 'redirect', redirect: { extensionPath: opts.blockedPagePath } } : { type: 'block' },
    condition: { requestDomains: domains, resourceTypes },
  };
}

export function compileDnr(ruleset: Ruleset, settings: Settings, opts: CompileOptions = {}): DnrRule[] {
  const now = opts.now ?? Date.now();
  if (!settings.enabled) return [];
  if (settings.pauseUntil && settings.pauseUntil > now) return [];

  const rules: DnrRule[] = [];
  let id = 1;
  const paused = validDomains(settings.pausedSites);

  for (const n of ruleset.network) {
    if (n.level > settings.level || settings.disabledRules.includes(n.id)) continue;
    const domains = n.domains.filter((d) => !paused.some((p) => d === p || d.endsWith('.' + p)));
    if (!domains.length) continue;
    rules.push({
      id: id++,
      priority: PRIORITY.block,
      action: { type: 'block' },
      condition: {
        requestDomains: domains,
        resourceTypes: n.resourceTypes?.length ? n.resourceTypes : SUB_RESOURCE_TYPES,
        ...(paused.length ? { excludedInitiatorDomains: paused } : {}),
      },
    });
    if (n.blockNavigation) rules.push(blackoutNavRule(id++, domains, ['main_frame'], opts));
  }

  const extra = validDomains(opts.managed?.denyExtraDomains);
  if (extra.length) rules.push(blackoutNavRule(id++, extra, ['main_frame', 'sub_frame'], opts));

  for (const site of ruleset.sites) {
    for (const rule of site.rules) {
      if (rule.kind !== 'urlRewrite' || !ruleEnabled(rule, site, settings)) continue;
      const rw = rule as UrlRewriteRule;
      const missing = rw.when?.paramMissing;
      const missingList = missing == null ? [] : Array.isArray(missing) ? missing : [missing];
      const seen = new Set<string>();
      for (const pattern of site.match) {
        const base = patternToRe2(pattern, ruleset.hostGroups, rw.when?.pathPrefix);
        if (!base || seen.has(base.regex)) continue;
        seen.add(base.regex);
        const domains = base.requestDomains ? { requestDomains: base.requestDomains } : {};
        const excluded = paused.length ? { excludedRequestDomains: paused } : {};
        for (const param of missingList) {
          rules.push({
            id: id++,
            priority: PRIORITY.rewriteSkip,
            action: { type: 'allow' },
            condition: {
              regexFilter: `${base.regex}.*[?&]${param.replace(/[^\w-]/g, '')}=`,
              resourceTypes: ['main_frame'],
              ...domains,
            },
          });
        }
        rules.push({
          id: id++,
          priority: PRIORITY.rewrite,
          action: {
            type: 'redirect',
            redirect: {
              transform: {
                queryTransform: {
                  ...(rw.set
                    ? { addOrReplaceParams: Object.entries(rw.set).map(([key, value]) => ({ key, value })) }
                    : {}),
                  ...(rw.remove?.length ? { removeParams: rw.remove } : {}),
                },
              },
            },
          },
          condition: { regexFilter: base.regex, resourceTypes: ['main_frame'], ...domains, ...excluded },
        });
      }
    }
  }
  return rules;
}

/** Hosts the DNR rules need host permissions for (redirects require them). */
export function dnrRegexBudget(rules: DnrRule[]): number {
  return rules.filter((r) => r.condition.regexFilter).length;
}
