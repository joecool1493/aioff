// Signs dist/rules.json with Ed25519. Key comes from AIOFF_RULES_PRIVATE_KEY (PEM) or --key <path>.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES_ROOT } from './load.ts';

const keyArg = process.argv.indexOf('--key');
const pem =
  keyArg !== -1 ? readFileSync(process.argv[keyArg + 1]!, 'utf8') : process.env.AIOFF_RULES_PRIVATE_KEY;
if (!pem) {
  console.error('No signing key. Set AIOFF_RULES_PRIVATE_KEY or pass --key <path to PEM>.');
  process.exit(1);
}
const payload = readFileSync(join(RULES_ROOT, 'dist', 'rules.json'));
const signature = sign(null, payload, createPrivateKey(pem)).toString('base64');
writeFileSync(join(RULES_ROOT, 'dist', 'rules.json.sig'), signature + '\n');
console.log(`signed ${payload.length} bytes -> dist/rules.json.sig`);
