// Turns a health check report into GitHub issues (label: rule-broken), one per broken rule.
// Re-runs update the existing open issue instead of opening a duplicate. Optional Slack webhook.
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo), SLACK_WEBHOOK_URL (optional).
// Run as `pnpm --filter @aioff/healthcheck run report-issues`. The script is not called "issues":
// pnpm 10+ has a built-in `bugs` command with the alias `issues`, which shadows a script of that name.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SiteResult } from './run.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = join(ROOT, 'healthcheck-report');
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const dryRun = !token || !repo || process.argv.includes('--dry-run');

interface Report { rulesVersion: string; locale: string; browser: string; ranAt: string; results: SiteResult[] }
const reports: Report[] = existsSync(OUT)
  ? readdirSync(OUT).filter((f) => /^report-.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(OUT, f), 'utf8')))
  : [];

// A rule is broken only when it failed in every locale and browser that could load the page.
const broken = new Map<string, { site: SiteResult; reports: Report[] }>();
const healthyAnywhere = new Set<string>();
for (const report of reports) {
  for (const site of report.results) {
    for (const id of site.healthy) healthyAnywhere.add(id);
    for (const id of site.broken) {
      const cur = broken.get(id) ?? { site, reports: [] };
      cur.reports.push(report);
      broken.set(id, cur);
    }
  }
}
for (const id of healthyAnywhere) broken.delete(id);

async function gh(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`);
  return res.json();
}

for (const [ruleId, { site, reports: where }] of broken) {
  const title = `Rule broken: ${ruleId} (${site.name})`;
  const body = [
    `The nightly health check could not match \`${ruleId}\` on **${site.name}**.`,
    '',
    `Failed in: ${where.map((r) => `${r.browser} ${r.locale}`).join(', ')}`,
    `Rules version: ${where[0]!.rulesVersion}`,
    '',
    '### URLs checked',
    ...site.entries.map((e) => `- ${e.url}${e.blocked ? ` (${e.blocked})` : ''}${e.error ? ` (error: ${e.error})` : ''}`),
    '',
    'Screenshots and the DOM snapshot are attached to the workflow run as artifacts.',
    '',
    'Fix: update the selectors or text anchors in `packages/rules/src/sites/' + site.siteId + '.json`, recapture the fixture, open a PR.',
  ].join('\n');
  if (dryRun) {
    console.log(`[dry run] would open: ${title}`);
    continue;
  }
  const open = (await gh(`/issues?state=open&labels=rule-broken&per_page=100`)) as { number: number; title: string }[];
  const existing = open.find((i) => i.title === title);
  if (existing) await gh(`/issues/${existing.number}/comments`, { method: 'POST', body: JSON.stringify({ body: `Still broken on ${new Date().toISOString().slice(0, 10)}.\n\n${body}` }) });
  else await gh('/issues', { method: 'POST', body: JSON.stringify({ title, body, labels: ['rule-broken'] }) });
  console.log(`${existing ? 'updated' : 'opened'}: ${title}`);
}

if (broken.size && process.env.SLACK_WEBHOOK_URL && !dryRun) {
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `AI Off health check: ${broken.size} broken rule(s): ${[...broken.keys()].join(', ')}` }),
  });
}
console.log(`${broken.size} broken rule(s) across ${reports.length} report(s)`);
