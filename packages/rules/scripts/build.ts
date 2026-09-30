// Builds dist/rules.json (minified, the signed artifact), a pretty copy, and a summary for the site.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { loadRuleset, RULES_ROOT } from './load.ts';
import { lintRuleset } from './lint.ts';

const ruleset = loadRuleset();
ruleset.generatedAt = new Date().toISOString();

const schema = JSON.parse(readFileSync(join(RULES_ROOT, 'schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
if (!validate(ruleset)) {
  console.error('Ruleset failed schema validation:');
  for (const e of validate.errors ?? []) console.error(`  ${e.instancePath} ${e.message}`);
  process.exit(1);
}
const problems = lintRuleset(ruleset);
for (const p of problems) console.error(`${p.severity.toUpperCase()}: ${p.message}`);
if (problems.some((p) => p.severity === 'error')) process.exit(1);

const dist = join(RULES_ROOT, 'dist');
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'rules.json'), JSON.stringify(ruleset));
writeFileSync(join(dist, 'rules.pretty.json'), JSON.stringify(ruleset, null, 2) + '\n');

// Site rules only, so "N rules across M sites" matches the rows on the What AI Off hides page.
const ruleCount = ruleset.sites.reduce((n, s) => n + s.rules.length, 0);
const summary = {
  version: ruleset.version,
  generatedAt: ruleset.generatedAt,
  siteCount: ruleset.sites.length,
  ruleCount,
  networkRuleCount: ruleset.network.length,
  muteTermCount: ruleset.mute.terms.length,
  blockedDomainCount: ruleset.network.reduce((n, r) => n + r.domains.length, 0),
};
writeFileSync(join(dist, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`rules ${ruleset.version}: ${summary.siteCount} sites, ${ruleCount} site rules, ${summary.networkRuleCount} network tiers, ${summary.muteTermCount} mute terms`);
