// Writes today's healthy rules into each site's healthcheck "expect" list. Run once after a
// clean health check: from then on, a rule that stops matching is reported as broken.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SiteResult } from './run.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const report = JSON.parse(readFileSync(join(ROOT, 'healthcheck-report', 'report-en-US.json'), 'utf8')) as { results: SiteResult[] };
for (const site of report.results) {
  if (site.unverifiable) continue;
  const path = join(ROOT, 'packages', 'rules', 'src', 'sites', `${site.siteId}.json`);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  for (const entry of json.healthcheck?.entries ?? []) {
    const live = site.entries.find((e) => e.url === entry.url);
    const healthy = live?.rules.filter((r) => r.bySelector + r.byAnchor > 0).map((r) => r.ruleId) ?? [];
    if (healthy.length) entry.expect = healthy;
    else delete entry.expect;
  }
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  console.log(`${site.siteId}: expect ${site.healthy.join(', ') || '(nothing verifiable logged out)'}`);
}
