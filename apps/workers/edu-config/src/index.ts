// Hosted org config for AI Off for Schools.
//   GET  /org/<token>.json       the org's managed config (public, unguessable token, no student data)
//   GET  /org/<token>.json.sig   Ed25519 signature over those exact bytes (the extension verifies it)
//   PUT  /org/<token>            admin updates the config. Header: Authorization: Bearer <admin secret>
//   POST /org/<token>/exam       {"enabled":true,"until":"2026-10-02T15:00:00Z"} flips Exam Mode now
//
// KV value: { config: ManagedConfig, adminHash: hex sha256(pepper + admin secret) }
// The extension polls every 15 minutes, so Exam Mode lands far faster than a Google Admin policy push.

interface Env {
  ORGS: KVNamespace;
  ORG_CONFIG_PRIVATE_KEY_PKCS8_B64: string;
  ADMIN_TOKEN_PEPPER: string;
}
interface OrgRecord { config: Record<string, unknown>; adminHash: string }

const ALLOWED_KEYS = new Set(['orgName', 'level', 'locked', 'allowSites', 'denyExtraDomains', 'muteExtraTerms', 'schedule', 'examMode', 'reporting']);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(bytes: Uint8Array, env: Env): Promise<string> {
  const pkcs8 = Uint8Array.from(atob(env.ORG_CONFIG_PRIVATE_KEY_PKCS8_B64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, bytes));
  return btoa(String.fromCharCode(...sig));
}

function sanitize(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (ALLOWED_KEYS.has(k)) out[k] = v;
  out.reporting = { mode: 'none' }; // v1 holds the line: no reporting, no student data
  return out;
}

/** Stable serialization so the .json and .json.sig responses always agree. */
const serialize = (config: Record<string, unknown>) => new TextEncoder().encode(JSON.stringify(config));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = /^\/org\/([A-Za-z0-9_-]{20,64})(\.json|\.json\.sig|\/exam)?$/.exec(url.pathname);
    if (!m) return new Response('AI Off org config', { status: url.pathname === '/' ? 200 : 404 });
    const [, token, suffix] = m;
    const record = (await env.ORGS.get(`org:${token}`, 'json')) as OrgRecord | null;

    if (req.method === 'GET' && (suffix === '.json' || suffix === '.json.sig')) {
      if (!record) return new Response('not found', { status: 404 });
      const bytes = serialize(record.config);
      const headers = { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' };
      if (suffix === '.json') return new Response(bytes, { headers: { ...headers, 'Content-Type': 'application/json' } });
      return new Response(await sign(bytes, env), { headers: { ...headers, 'Content-Type': 'text/plain' } });
    }

    const auth = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    const authHash = await sha256Hex(env.ADMIN_TOKEN_PEPPER + auth);
    if (!record || !auth || authHash !== record.adminHash) return json({ error: 'unauthorized' }, 401);

    if (req.method === 'PUT' && !suffix) {
      const config = sanitize((await req.json()) as Record<string, unknown>);
      await env.ORGS.put(`org:${token}`, JSON.stringify({ ...record, config }));
      return json({ ok: true, config });
    }
    if (req.method === 'POST' && suffix === '/exam') {
      const body = (await req.json()) as { enabled?: boolean; until?: string };
      const config = { ...record.config, examMode: { enabled: !!body.enabled, ...(body.until ? { until: body.until } : {}) } };
      await env.ORGS.put(`org:${token}`, JSON.stringify({ ...record, config }));
      return json({ ok: true, examMode: config.examMode });
    }
    return json({ error: 'method not allowed' }, 405);
  },
};
