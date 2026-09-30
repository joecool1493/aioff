// Offline license keys. A key is "AIOFF-<payload>.<signature>", both base64url.
// The payload is JSON; the signature is Ed25519 over the payload bytes. Verification
// needs no server and no account, which is the point.

export interface LicensePayload {
  /** Short id, also what a revocation list would carry. */
  id: string;
  plan: 'pro' | 'family' | 'lifetime' | 'edu';
  devices: number;
  issued: string;
  /** ISO date. Absent for lifetime. */
  expires?: string;
  /** Organization name for edu keys. Never an email: keys get pasted into screenshots. */
  org?: string;
}

export type LicenseResult =
  | { valid: true; payload: LicensePayload; expired: boolean }
  | { valid: false; reason: 'format' | 'signature' | 'payload' };

const PREFIX = 'AIOFF-';

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function verifyLicense(key: string, publicKeysB64: string[], now = new Date()): Promise<LicenseResult> {
  const trimmed = key.trim().replace(/\s+/g, '');
  if (!trimmed.startsWith(PREFIX)) return { valid: false, reason: 'format' };
  const [payloadPart, sigPart, extra] = trimmed.slice(PREFIX.length).split('.');
  if (!payloadPart || !sigPart || extra !== undefined) return { valid: false, reason: 'format' };
  let payloadBytes: Uint8Array<ArrayBuffer>;
  let sig: Uint8Array<ArrayBuffer>;
  try {
    payloadBytes = b64urlToBytes(payloadPart);
    sig = b64urlToBytes(sigPart);
  } catch {
    return { valid: false, reason: 'format' };
  }
  let ok = false;
  for (const pk of publicKeysB64) {
    try {
      const raw = b64urlToBytes(pk.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
      const k = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
      if (await crypto.subtle.verify({ name: 'Ed25519' }, k, sig, payloadBytes)) {
        ok = true;
        break;
      }
    } catch {
      /* next key */
    }
  }
  if (!ok) return { valid: false, reason: 'signature' };
  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicensePayload;
    if (!payload.id || !payload.plan || typeof payload.devices !== 'number') return { valid: false, reason: 'payload' };
    const expired = !!payload.expires && Date.parse(payload.expires) < now.getTime();
    return { valid: true, payload, expired };
  } catch {
    return { valid: false, reason: 'payload' };
  }
}

/** Issue a key. Used by the license worker and by tools/scripts/license.ts. privateKey is a CryptoKey with "sign". */
export async function issueLicense(payload: LicensePayload, privateKey: CryptoKey): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, bytes));
  return `${PREFIX}${bytesToB64url(bytes)}.${bytesToB64url(sig)}`;
}
