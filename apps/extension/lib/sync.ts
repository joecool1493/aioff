// Pro sync, extension side. Everything crypto lives in @aioff/core; this file only moves bytes.
// Push: encrypt Settings, PUT. Pull: GET, decrypt, apply if the remote copy is newer.
// The license key authorizes the request; the passphrase-derived id addresses the blob.
import { base64ToBytes, decryptBlob, encryptBlob, sanitizeSettings, type Settings, type SyncPayload } from '@aioff/core';
import { SYNC_URL } from './constants';
import { getStore, setStore } from './storage';

export type SyncResult = { ok: true; action: 'pushed' | 'pulled' | 'up-to-date' | 'nothing-remote' } | { ok: false; error: string };

async function ready() {
  const { pro } = await getStore('pro');
  if (!pro.license || !pro.sync.enabled || !pro.sync.blobId || !pro.sync.keyB64) return null;
  return { pro, key: base64ToBytes(pro.sync.keyB64), url: SYNC_URL + pro.sync.blobId, auth: { Authorization: `License ${pro.license}` } };
}

async function fail(error: string): Promise<SyncResult> {
  const { pro } = await getStore('pro');
  await setStore({ pro: { ...pro, sync: { ...pro.sync, lastError: error } } });
  return { ok: false, error };
}

export async function pushSettings(): Promise<SyncResult> {
  const r = await ready();
  if (!r) return { ok: false, error: 'sync is not set up' };
  const { settings } = await getStore('settings');
  const updatedAt = r.pro.sync.localUpdatedAt || Date.now();
  const payload: SyncPayload<Settings> = { v: 1, updatedAt, settings };
  try {
    const blob = await encryptBlob(r.key, payload);
    const res = await fetch(r.url, { method: 'PUT', headers: { ...r.auth, 'Content-Type': 'application/octet-stream', 'X-Updated-At': String(updatedAt) }, body: blob });
    if (res.status === 401) return fail('The license key is not valid or has expired.');
    if (!res.ok) return fail(`Sync server answered ${res.status}.`);
    const { pro } = await getStore('pro');
    await setStore({ pro: { ...pro, sync: { ...pro.sync, lastPush: Date.now(), etag: res.headers.get('ETag'), lastError: null } } });
    return { ok: true, action: 'pushed' };
  } catch (e) {
    return fail(String((e as Error).message ?? e));
  }
}

export async function pullSettings(): Promise<SyncResult> {
  const r = await ready();
  if (!r) return { ok: false, error: 'sync is not set up' };
  try {
    const res = await fetch(r.url, { headers: { ...r.auth, ...(r.pro.sync.etag ? { 'If-None-Match': r.pro.sync.etag } : {}) } });
    if (res.status === 304) return { ok: true, action: 'up-to-date' };
    if (res.status === 404) return { ok: true, action: 'nothing-remote' };
    if (res.status === 401) return fail('The license key is not valid or has expired.');
    if (!res.ok) return fail(`Sync server answered ${res.status}.`);
    const blob = new Uint8Array(await res.arrayBuffer());
    const payload = await decryptBlob<SyncPayload<Settings>>(r.key, blob);
    if (payload.v !== 1 || !payload.settings) return fail('The remote copy could not be read.');
    const { pro } = await getStore('pro');
    const remoteNewer = payload.updatedAt > pro.sync.localUpdatedAt;
    await setStore({
      ...(remoteNewer ? { settings: sanitizeSettings(payload.settings) } : {}),
      pro: { ...pro, sync: { ...pro.sync, lastPull: Date.now(), etag: res.headers.get('ETag'), lastError: null, ...(remoteNewer ? { localUpdatedAt: payload.updatedAt } : {}) } },
    });
    return { ok: true, action: remoteNewer ? 'pulled' : 'up-to-date' };
  } catch (e) {
    // A wrong passphrase on this device shows up here as a decrypt failure.
    return fail(/decrypt|operation/i.test(String(e)) ? 'Could not decrypt: this device uses a different passphrase.' : String((e as Error).message ?? e));
  }
}
