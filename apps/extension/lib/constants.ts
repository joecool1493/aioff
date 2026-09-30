// The only network endpoints AI Off ever talks to. Keep this file short and auditable.
// WXT_FEED_URL exists only so the proof script (tools/healthcheck/src/proof.ts) can point a
// throwaway build at a local server. Production builds never set it.
export const FEED_URL: string = (import.meta.env.WXT_FEED_URL as string | undefined) || 'https://rules.aioff.app/rules.json';
export const FEED_SIG_URL = FEED_URL + '.sig';
export const FEED_INTERVAL_MINUTES = 360; // every 6 hours
export const MANAGED_CONFIG_INTERVAL_MINUTES = 15;
export const LISTS_INTERVAL_MINUTES = 60 * 24;
// Change this once when the project moves to its own GitHub org.
export const RULES_REPO = 'joecool1493/aioff';
export const SITE_URL = 'https://aioff.app';
/** Pro, opt-in only. Receives an encrypted blob it cannot read. See lib/sync.ts. */
export const SYNC_URL = 'https://sync.aioff.app/v1/blob/';
export const SYNC_INTERVAL_MINUTES = 360;
