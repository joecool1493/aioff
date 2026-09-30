// Encrypted settings sync (Pro). Zero knowledge: the server stores a blob it cannot read,
// under an id it cannot link to a person. The passphrase is the account; there is no account.
//
//   passphrase --PBKDF2(600k, SHA-256)--> master
//   master --HKDF("aioff-sync-enc")--> AES-256-GCM key      (encrypts the settings JSON)
//   master --HKDF("aioff-sync-id")-->  32 bytes, hex        (the blob id on the server)
//
// Losing the passphrase loses the blob. That is the deal, and the UI says so.

const enc = new TextEncoder();
const dec = new TextDecoder();
const SALT = enc.encode('aioff-sync-v1');
const ITERATIONS = 600_000;

export interface SyncKeys {
  /** Hex, 64 chars. Safe to send to the server. */
  blobId: string;
  /** Raw AES-256-GCM key bytes. Stored locally only. */
  keyBytes: Uint8Array<ArrayBuffer>;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function deriveSyncKeys(passphrase: string): Promise<SyncKeys> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' }, base, 256);
  const hk = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
  const encBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode('aioff-sync-enc') }, hk, 256);
  const idBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode('aioff-sync-id') }, hk, 256);
  return { blobId: hex(idBits), keyBytes: new Uint8Array(encBits) };
}

async function aesKey(keyBytes: Uint8Array<ArrayBuffer>, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [usage]);
}

/** Output: 12-byte IV followed by the ciphertext (which includes the GCM tag). */
export async function encryptBlob(keyBytes: Uint8Array<ArrayBuffer>, data: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyBytes, 'encrypt'), enc.encode(JSON.stringify(data)));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return out;
}

/** Throws on a wrong key or a tampered blob (GCM authenticates). */
export async function decryptBlob<T = unknown>(keyBytes: Uint8Array<ArrayBuffer>, blob: Uint8Array<ArrayBuffer>): Promise<T> {
  if (blob.length < 13) throw new Error('blob too short');
  const iv = blob.subarray(0, 12);
  const ct = blob.subarray(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(keyBytes, 'decrypt'), ct);
  return JSON.parse(dec.decode(pt)) as T;
}

/** What travels in the blob. `updatedAt` decides which side wins (last writer). */
export interface SyncPayload<S> {
  v: 1;
  updatedAt: number;
  settings: S;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
