import { describe, expect, it } from 'vitest';
import { issueLicense, verifyLicense, type LicensePayload } from '../src/index.ts';

async function keypair() {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  return { privateKey: kp.privateKey, publicB64: Buffer.from(raw).toString('base64') };
}

describe('offline license keys', () => {
  const payload: LicensePayload = { id: 'L-0001', plan: 'pro', devices: 5, issued: '2026-09-20', expires: '2027-09-20' };

  it('round-trips and verifies without a server', async () => {
    const { privateKey, publicB64 } = await keypair();
    const key = await issueLicense(payload, privateKey);
    expect(key.startsWith('AIOFF-')).toBe(true);
    const res = await verifyLicense(`  ${key}\n`, [publicB64], new Date('2026-12-01'));
    expect(res).toEqual({ valid: true, payload, expired: false });
  });
  it('flags expiry but still reports the payload, so the app can say "renew" instead of "invalid"', async () => {
    const { privateKey, publicB64 } = await keypair();
    const res = await verifyLicense(await issueLicense(payload, privateKey), [publicB64], new Date('2028-01-01'));
    expect(res.valid && res.expired).toBe(true);
  });
  it('lifetime keys never expire', async () => {
    const { privateKey, publicB64 } = await keypair();
    const res = await verifyLicense(await issueLicense({ id: 'L-2', plan: 'lifetime', devices: 5, issued: '2026-09-20' }, privateKey), [publicB64], new Date('2099-01-01'));
    expect(res.valid && !res.expired).toBe(true);
  });
  it('rejects forged, edited, and malformed keys', async () => {
    const a = await keypair();
    const b = await keypair();
    const key = await issueLicense(payload, a.privateKey);
    expect(await verifyLicense(key, [b.publicB64])).toEqual({ valid: false, reason: 'signature' });
    const [p, s] = key.slice(6).split('.');
    const edited = Buffer.from(JSON.stringify({ ...payload, devices: 500 })).toString('base64url');
    expect(await verifyLicense(`AIOFF-${edited}.${s}`, [a.publicB64])).toEqual({ valid: false, reason: 'signature' });
    expect(await verifyLicense(`AIOFF-${p}`, [a.publicB64])).toEqual({ valid: false, reason: 'format' });
    expect(await verifyLicense('hello', [a.publicB64])).toEqual({ valid: false, reason: 'format' });
  });
});
