import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, decryptBlob, deriveSyncKeys, encryptBlob } from '../src/index.ts';

describe('encrypted sync', () => {
  it('derives a stable id and key from a passphrase, and different ones from a different passphrase', async () => {
    const a = await deriveSyncKeys('correct horse battery staple');
    const b = await deriveSyncKeys('correct horse battery staple');
    const c = await deriveSyncKeys('Correct horse battery staple');
    expect(a.blobId).toBe(b.blobId);
    expect(a.blobId).toMatch(/^[0-9a-f]{64}$/);
    expect(bytesToBase64(a.keyBytes)).toBe(bytesToBase64(b.keyBytes));
    expect(c.blobId).not.toBe(a.blobId);
    // the id must not reveal the key
    expect(a.blobId).not.toContain(bytesToBase64(a.keyBytes).slice(0, 8));
  }, 20_000);

  it('round-trips, uses a fresh IV each time, and rejects the wrong key or a tampered blob', async () => {
    const { keyBytes } = await deriveSyncKeys('pass one');
    const other = (await deriveSyncKeys('pass two')).keyBytes;
    const data = { v: 1, updatedAt: 123, settings: { level: 2, userMuteTerms: ['blockchain'] } };
    const blob1 = await encryptBlob(keyBytes, data);
    const blob2 = await encryptBlob(keyBytes, data);
    expect(bytesToBase64(blob1)).not.toBe(bytesToBase64(blob2));
    expect(await decryptBlob(keyBytes, blob1)).toEqual(data);
    await expect(decryptBlob(other, blob1)).rejects.toThrow();
    const tampered = new Uint8Array(blob1);
    tampered[20] = tampered[20]! ^ 1;
    await expect(decryptBlob(keyBytes, tampered)).rejects.toThrow();
    expect(base64ToBytes(bytesToBase64(blob1))).toEqual(blob1);
  }, 20_000);
});
