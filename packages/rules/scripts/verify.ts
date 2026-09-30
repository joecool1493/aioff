// Verifies dist/rules.json against dist/rules.json.sig with the committed public keys,
// through the same code path the extension uses.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifySignature } from '@aioff/core';
import { RULES_ROOT } from './load.ts';

const payload = new Uint8Array(readFileSync(join(RULES_ROOT, 'dist', 'rules.json')));
const sig = readFileSync(join(RULES_ROOT, 'dist', 'rules.json.sig'), 'utf8').trim();
const keys = JSON.parse(readFileSync(join(RULES_ROOT, 'public-keys.json'), 'utf8')).keys.map(
  (k: { publicKey: string }) => k.publicKey,
);
const ok = await verifySignature(payload, sig, keys);
console.log(ok ? 'signature OK' : 'SIGNATURE INVALID');
process.exit(ok ? 0 : 1);
