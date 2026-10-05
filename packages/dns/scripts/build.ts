import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATS, guardViolations, render, ruleCount, SHORT_RULE_LIMIT, shortOutsideProducts, tier, TIERS } from '../src/index.ts';

const violations = guardViolations();
if (violations.length) {
  console.error('Never-block guard failed:\n  ' + violations.join('\n  '));
  process.exit(1);
}
const stray = shortOutsideProducts();
if (stray.length) {
  console.error('Short Blackout entries must be in the products tier:\n  ' + stray.join('\n  '));
  process.exit(1);
}
const shortTotal = ruleCount('ads') + ruleCount('products-short');
if (shortTotal > SHORT_RULE_LIMIT) {
  console.error(`Ads plus short Blackout is ${shortTotal} rules. The limit is ${SHORT_RULE_LIMIT}.`);
  process.exit(1);
}
const version = new Date().toISOString().slice(0, 10);
const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
for (const t of TIERS) {
  mkdirSync(join(DIST, t), { recursive: true });
  for (const f of FORMATS) writeFileSync(join(DIST, t, f.file), render(t, f.format, version));
  console.log(`${t}: ${tier(t).length} domains, ${ruleCount(t)} rules x ${FORMATS.length} formats`);
}
writeFileSync(join(DIST, 'index.json'), JSON.stringify({ version, tiers: Object.fromEntries(TIERS.map((t) => [t, tier(t).length])), rules: Object.fromEntries(TIERS.map((t) => [t, ruleCount(t)])), formats: FORMATS }, null, 2) + '\n');
