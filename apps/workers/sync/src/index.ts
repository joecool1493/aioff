// Encrypted settings sync for AI Off Pro. The worker never sees a passphrase, a plaintext
// setting, or an email address. It stores ciphertext under an id derived from the passphrase
// and checks that the caller holds a valid, unexpired Pro license (verified offline with the
// same Ed25519 public keys the extension embeds).
//
//   GET  /v1/blob/<id>    -> ciphertext bytes, ETag, X-Updated-At   (404 if none)
//   PUT  /v1/blob/<id>    <- ciphertext bytes (max 64 KB), header Authorization: License AIOFF-...
//   DELETE /v1/blob/<id>  -> forget it
//
// CORS is open because the extension calls this without a host permission. That is safe:
// nothing here is readable without the id, and the id is 256 bits derived from a passphrase.
import { verifyLicense } from '@aioff/core/license';
import publicKeys from '../../../../packages/rules/public-keys.json' with { type: 'json' };

interface Env { BLOBS: R2Bucket }

const KEYS = (publicKeys as { keys: { publicKey: string }[] }).keys.map((k) => k.publicKey);
const MAX_BYTES = 64 * 1024;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match, X-Updated-At',
  'Access-Control-Expose-Headers': 'ETag, X-Updated-At',
};
const reply = (body: BodyInit | null, status: number, headers: Record<string, string> = {}) => new Response(body, { status, headers: { ...CORS, ...headers } });

async function licensed(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('License ')) return false;
  const res = await verifyLicense(auth.slice(8), KEYS);
  return res.valid && !res.expired && res.payload.devices > 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return reply(null, 204);
    const m = /^\/v1\/blob\/([0-9a-f]{64})$/.exec(new URL(req.url).pathname);
    if (!m) return reply('AI Off sync', 200, { 'Content-Type': 'text/plain' });
    const id = m[1]!;
    if (!(await licensed(req))) return reply('a valid AI Off Pro license is required', 401);

    if (req.method === 'GET') {
      const obj = await env.BLOBS.get(id);
      if (!obj) return reply(null, 404);
      const etag = obj.httpEtag;
      if (req.headers.get('If-None-Match') === etag) return reply(null, 304, { ETag: etag });
      return reply(obj.body, 200, { 'Content-Type': 'application/octet-stream', ETag: etag, 'X-Updated-At': obj.customMetadata?.updatedAt ?? '0' });
    }
    if (req.method === 'PUT') {
      const len = Number(req.headers.get('Content-Length') ?? '0');
      if (len > MAX_BYTES) return reply('too large', 413);
      const body = await req.arrayBuffer();
      if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return reply('bad size', 400);
      const updatedAt = String(Number(req.headers.get('X-Updated-At') ?? Date.now()));
      const obj = await env.BLOBS.put(id, body, { customMetadata: { updatedAt } });
      return reply(null, 204, { ETag: obj.httpEtag });
    }
    if (req.method === 'DELETE') {
      await env.BLOBS.delete(id);
      return reply(null, 204);
    }
    return reply('method not allowed', 405);
  },
};
