// Generates an Ed25519 signing keypair. The private key is written to keys/ (gitignored)
// and must be stored as the AIOFF_RULES_PRIVATE_KEY GitHub secret. Only the public key is committed.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RULES_ROOT } from './load.ts';

const label = process.argv[2] ?? 'dev';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const keysDir = join(RULES_ROOT, '..', '..', 'keys');
mkdirSync(keysDir, { recursive: true });
const privPath = join(keysDir, `rules-${label}.private.pem`);
if (existsSync(privPath)) {
  console.error(`${privPath} already exists. Refusing to overwrite a signing key.`);
  process.exit(1);
}
writeFileSync(privPath, pem, { mode: 0o600 });

const pkPath = join(RULES_ROOT, 'public-keys.json');
const current = existsSync(pkPath) ? JSON.parse(readFileSync(pkPath, 'utf8')) : { keys: [] };
current.keys.push({ label, publicKey: rawPublic, added: new Date().toISOString().slice(0, 10) });
writeFileSync(pkPath, JSON.stringify(current, null, 2) + '\n');

console.log(`Public key (${label}): ${rawPublic}`);
console.log(`Private key written to ${privPath}`);
console.log('Store the private key PEM as the GitHub secret AIOFF_RULES_PRIVATE_KEY, then delete the file or move it offline.');
