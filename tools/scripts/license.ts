// Issue or check a license key by hand (support, gifts, school quotes).
//   pnpm tsx tools/scripts/license.ts keygen
//   AIOFF_LICENSE_PRIVATE_KEY_PKCS8_B64=... pnpm tsx tools/scripts/license.ts issue pro 5 2027-09-20
//   pnpm tsx tools/scripts/license.ts check AIOFF-....
import { readFileSync } from 'node:fs';
import { issueLicense, verifyLicense, type LicensePayload } from '../../packages/core/src/license.ts';

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'keygen') {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64');
  const priv = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
  console.log(`Public key (add to packages/rules/public-keys.json with label "license"):\n${pub}\n`);
  console.log(`Private key, PKCS8 base64 (store as the worker secret LICENSE_PRIVATE_KEY_PKCS8_B64, never commit):\n${priv}`);
} else if (cmd === 'issue') {
  const [plan = 'pro', devices = '5', expires] = rest;
  const pkcs8 = Buffer.from(process.env.AIOFF_LICENSE_PRIVATE_KEY_PKCS8_B64 ?? '', 'base64');
  if (!pkcs8.length) throw new Error('Set AIOFF_LICENSE_PRIVATE_KEY_PKCS8_B64');
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const payload: LicensePayload = { id: `L-${Date.now().toString(36)}`, plan: plan as LicensePayload['plan'], devices: Number(devices), issued: new Date().toISOString().slice(0, 10), ...(expires ? { expires } : {}) };
  console.log(await issueLicense(payload, key));
} else if (cmd === 'check') {
  const keys = JSON.parse(readFileSync(new URL('../../packages/rules/public-keys.json', import.meta.url), 'utf8')).keys.map((k: { publicKey: string }) => k.publicKey);
  console.log(await verifyLicense(rest[0] ?? '', keys));
} else {
  console.log('usage: license.ts keygen | issue <plan> <devices> [expires] | check <key>');
}
