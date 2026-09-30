// Signed feed verification. Ed25519 over the exact bytes of rules.json.
// Uses WebCrypto (Chrome 137+, Firefox 129+, Safari 17+, Node 20+). No dependencies.

import { compareVersions } from './engine.ts';
import type { Ruleset } from './types.ts';

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function verifySignature(
  payload: Uint8Array<ArrayBuffer>,
  signatureB64: string,
  publicKeysB64: string[],
): Promise<boolean> {
  const sig = b64ToBytes(signatureB64);
  // More than one key allows rotation: ship the next key before retiring the old one.
  for (const keyB64 of publicKeysB64) {
    try {
      const key = await crypto.subtle.importKey('raw', b64ToBytes(keyB64), { name: 'Ed25519' }, false, ['verify']);
      if (await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, payload)) return true;
    } catch {
      /* try the next key */
    }
  }
  return false;
}

export type FeedResult =
  | { ok: true; ruleset: Ruleset }
  | { ok: false; reason: 'bad-signature' | 'bad-json' | 'older-version' | 'needs-newer-extension' | 'bad-shape' };

export interface AcceptOptions {
  publicKeys: string[];
  currentVersion: string;
  extensionVersion: string;
}

/** Reject any feed with a bad signature or a version older than what we already have. */
export async function acceptFeed(
  payload: Uint8Array<ArrayBuffer>,
  signatureB64: string,
  opts: AcceptOptions,
): Promise<FeedResult> {
  if (!(await verifySignature(payload, signatureB64, opts.publicKeys))) return { ok: false, reason: 'bad-signature' };
  let ruleset: Ruleset;
  try {
    ruleset = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  if (!ruleset || typeof ruleset.version !== 'string' || !Array.isArray(ruleset.sites) || !ruleset.mute) {
    return { ok: false, reason: 'bad-shape' };
  }
  if (compareVersions(ruleset.version, opts.currentVersion) < 0) return { ok: false, reason: 'older-version' };
  if (compareVersions(opts.extensionVersion, ruleset.minExtensionVersion ?? '0') < 0) {
    return { ok: false, reason: 'needs-newer-extension' };
  }
  return { ok: true, ruleset };
}
