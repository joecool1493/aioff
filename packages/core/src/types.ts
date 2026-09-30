// Types for the AI Off rules feed. The JSON Schema in packages/rules/schema.json
// is the source of truth for validation; keep the two in sync.

export type Level = 1 | 2 | 3 | 4;

export interface RuleBase {
  id: string;
  description: string;
  /** Overrides the site level for this rule. */
  level?: Level;
  /** ISO date the rule was added. */
  since?: string;
  /** ISO date after which the build prunes the rule. */
  until?: string;
  /** False means the rule ships off and the user opts in (example: GitHub Copilot). */
  defaultEnabled?: boolean;
}

export interface HideRule extends RuleBase {
  kind: 'hide' | 'remove';
  selectors: string[];
  /** Fallback when no selector matches: visible text that starts with one of these. */
  textAnchors?: string[];
  /** What to hide when a text anchor matches. Default "block". */
  anchorTarget?: 'block' | 'control' | 'self';
  /** closest() selector used for the anchor container instead of the default block lookup. */
  anchorContainer?: string;
  /** Limit the anchor search to elements under these selectors. */
  anchorScope?: string[];
  /** For each matched element, hide the closest ancestor matching this selector instead. */
  hideClosest?: string;
}

export interface UrlRewriteRule extends RuleBase {
  kind: 'urlRewrite';
  when?: {
    /** Only rewrite when none of these query params are present. */
    paramMissing?: string | string[];
    /** Only rewrite when the path starts with this prefix. */
    pathPrefix?: string;
  };
  set?: Record<string, string>;
  remove?: string[];
}

export interface SetCookieRule extends RuleBase {
  kind: 'setCookie';
  cookie: { name: string; value: string; domain: string; path?: string; maxAgeDays?: number };
}

export interface ClickRule extends RuleBase {
  kind: 'click';
  /** The site's own "turn off AI" control. Clicked at most once per site, then remembered. */
  selector: string;
  /** Only click when this selector also matches (example: the toggle is currently on). */
  onlyIf?: string;
}

export type Rule = HideRule | UrlRewriteRule | SetCookieRule | ClickRule;

export interface HealthcheckEntry {
  url: string;
  /** Rule ids expected to match on this URL. Defaults to every hide rule of the site. */
  expect?: string[];
  locale?: string;
  note?: string;
}

export interface Site {
  id: string;
  name: string;
  category:
    | 'search'
    | 'google'
    | 'microsoft'
    | 'social'
    | 'commerce'
    | 'knowledge'
    | 'dev'
    | 'productivity'
    | 'generic';
  match: string[];
  excludeMatch?: string[];
  level: Level;
  /** True when the site needs the optional all-sites permission (match is broad). */
  generic?: boolean;
  rules: Rule[];
  healthcheck?: { requiresLogin?: boolean; setup?: string; entries: HealthcheckEntry[] };
}

export interface NetworkRule {
  id: string;
  kind: 'block';
  level: Level;
  description: string;
  domains: string[];
  resourceTypes?: string[];
  /** Blackout rules also block top-level navigation and show the blocked page. */
  blockNavigation?: boolean;
}

export type MuteContainer = string | { selector: string; text?: string; nextSiblings?: number };

export interface MuteConfig {
  level: Level;
  terms: string[];
  exclusions: string[];
  matchMode: 'wordBoundary';
  /** hostname (suffix match) to container definitions */
  containers: Record<string, MuteContainer[]>;
  /** Containers used on hosts with no entry, only when the user enabled all-sites access. */
  genericContainers: MuteContainer[];
  /** Headline selectors inside generic containers. */
  headlineSelectors: string[];
  ads: {
    /** Selectors for ad slots that commonly survive ad blockers. */
    slotSelectors: string[];
    /** Landing domains of AI companies. */
    landingDomains: string[];
  };
}

export interface ProvenanceConfig {
  level: Level;
  hideC2paGenerative: boolean;
  /** IPTC digital source type codes treated as AI generated. */
  generativeSourceTypes: string[];
  /** IPTC digital source type codes treated as AI edited (badge only). */
  editedSourceTypes: string[];
  minImagePixels: number;
  domainLists: string[];
  youtubeChannelLists: string[];
  /** Small curated starter lists shipped inline. uBlacklist match pattern syntax. */
  starterDomains: string[];
  starterYoutubeChannels: string[];
  /** Where search engines put one result, so results from listed domains can be collapsed. */
  resultContainers: { host: string; container: string }[];
  /** Labels that platforms put on AI content; usable as a hide signal. */
  platformLabels: { host: string; container: string; labelSelectors: string[]; textAnchors?: string[] }[];
}

export interface Ruleset {
  version: string;
  minExtensionVersion: string;
  generatedAt?: string;
  /** Expansion lists for patterns with a wildcard TLD, keyed by the pattern host ("google.*"). */
  hostGroups: Record<string, string[]>;
  sites: Site[];
  network: NetworkRule[];
  mute: MuteConfig;
  provenance: ProvenanceConfig;
}

export interface UserRule {
  host: string;
  selector: string;
  created: string;
  note?: string;
}

export interface Settings {
  enabled: boolean;
  level: Level;
  /** Hostnames where AI Off is paused (the per-site allow list). */
  pausedSites: string[];
  /** Epoch ms until which everything is paused, or null. */
  pauseUntil: number | null;
  disabledRules: string[];
  enabledOptionalRules: string[];
  userMuteTerms: string[];
  disabledFeedTerms: string[];
  userRules: UserRule[];
  provenanceMode: 'hide' | 'badge';
  sound: boolean;
  /** Hosts where the user asked to see the support chat widget again. */
  showSupportChat: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  level: 1,
  pausedSites: [],
  pauseUntil: null,
  disabledRules: [],
  enabledOptionalRules: [],
  userMuteTerms: [],
  disabledFeedTerms: [],
  userRules: [],
  provenanceMode: 'hide',
  sound: true,
  showSupportChat: [],
};

/** Pro state. Kept apart from Settings so it is never part of the sync blob. */
export interface ProState {
  license: string | null;
  sync: {
    enabled: boolean;
    blobId: string | null;
    /** Base64 raw AES key derived from the passphrase. Local only. */
    keyB64: string | null;
    lastPush: number | null;
    lastPull: number | null;
    /** Epoch ms of the settings version last written locally; decides last-writer-wins. */
    localUpdatedAt: number;
    etag: string | null;
    lastError: string | null;
  };
}

export const DEFAULT_PRO: ProState = {
  license: null,
  sync: { enabled: false, blobId: null, keyB64: null, lastPush: null, lastPull: null, localUpdatedAt: 0, etag: null, lastError: null },
};

/** Managed configuration pushed by a school or organization. */
export interface ManagedConfig {
  orgName?: string;
  level?: Level;
  locked?: boolean;
  allowSites?: string[];
  denyExtraDomains?: string[];
  muteExtraTerms?: string[];
  schedule?: { timezone?: string; alwaysOn?: boolean; windows?: { days: number[]; start: string; end: string }[] };
  examMode?: { enabled?: boolean; until?: string };
  reporting?: { mode?: 'none' };
  configUrl?: string;
}
