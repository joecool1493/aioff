import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATS, guardViolations, render, tier, type Tier } from '../src/index.ts';

const violations = guardViolations();
if (violations.length) {
  console.error('Never-block guard failed:\n  ' + violations.join('\n  '));
  process.exit(1);
}
const version = new Date().toISOString().slice(0, 10);
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
for (const t of ['ads', 'products'] as Tier[]) {
  mkdirSync(join(DIST, t), { recursive: true });
  for (const f of FORMATS) writeFileSync(join(DIST, t, f.file), render(t, f.format, version));
  console.log(`${t}: ${tier(t).length} domains x ${FORMATS.length} formats`);
}
writeFileSync(join(DIST, 'index.json'), JSON.stringify({ version, tiers: { ads: tier('ads').length, products: tier('products').length }, formats: FORMATS }, null, 2) + '\n');
