// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, matchReport, resolvePage, type Settings } from '@aioff/core';
import { lintRuleset } from '../scripts/lint.ts';
import { loadRuleset, pruneExpired, RULES_ROOT } from '../scripts/load.ts';

const ruleset = loadRuleset({ version: '2026.9.20.1', today: '2026-09-20' });
// Everything on, so fixtures can exercise opt-in and higher-level rules too.
const ALL_ON: Settings = {
  ...DEFAULT_SETTINGS,
  level: 4,
  enabledOptionalRules: ruleset.sites.flatMap((s) => s.rules.filter((r) => r.defaultEnabled === false).map((r) => r.id)),
};

describe('ruleset', () => {
  it('validates against the JSON Schema', () => {
    const schema = JSON.parse(readFileSync(join(RULES_ROOT, 'schema.json'), 'utf8'));
    const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
    const ok = validate(ruleset);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
  it('rejects malformed rules', () => {
    const schema = JSON.parse(readFileSync(join(RULES_ROOT, 'schema.json'), 'utf8'));
    const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
    const bad = structuredClone(ruleset) as unknown as { sites: { rules: Record<string, unknown>[] }[] };
    bad.sites[0]!.rules[0] = { id: 'Bad Id', kind: 'hide', description: 'x' };
    expect(validate(bad)).toBe(false);
  });
  it('passes lint with no errors', () => {
    expect(lintRuleset(ruleset).filter((p) => p.severity === 'error')).toEqual([]);
  });
  it('ships the Phase 1 adapters', () => {
    const ids = ruleset.sites.map((s) => s.id);
    for (const id of ['search-google', 'search-bing', 'search-duckduckgo', 'gmail', 'youtube', 'linkedin', 'x', 'reddit', 'amazon', 'generic-ask-ai']) {
      expect(ids).toContain(id);
    }
  });
  it('ships GitHub Copilot rules off by default', () => {
    const gh = ruleset.sites.find((s) => s.id === 'github')!;
    expect(gh.rules.every((r) => r.defaultEnabled === false)).toBe(true);
  });
  it('never ships source-only notes or em dashes', () => {
    const text = JSON.stringify(ruleset);
    expect(text).not.toContain('"x":{');
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
  it('prunes expired rules at build time', () => {
    const sites = pruneExpired(
      [{ ...ruleset.sites[0]!, rules: [{ id: 'old', kind: 'hide', selectors: ['.x'], description: 'expired rule', until: '2026-01-01' }] }],
      '2026-09-20',
    );
    expect(sites).toEqual([]);
  });
});

interface FixtureMeta {
  kind: 'captured' | 'synthetic' | 'control';
  url: string;
  expect: string[];
}

const FIXTURES = join(RULES_ROOT, 'fixtures');
const siteDirs = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter((d) => !d.startsWith('.')) : [];

describe('fixtures', () => {
  for (const siteId of siteDirs) {
    const dir = join(FIXTURES, siteId);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const meta = JSON.parse(readFileSync(join(dir, file), 'utf8')) as FixtureMeta;
      const htmlFile = file.replace(/\.json$/, '.html');
      it(`${siteId}/${htmlFile} (${meta.kind})`, () => {
        const html = readFileSync(join(dir, htmlFile), 'utf8');
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const page = resolvePage(ruleset, new URL(meta.url), ALL_ON);
        const siteRules = page.hide.filter((h) => h.siteId === siteId);
        expect(siteRules.length).toBeGreaterThan(0);
        const report = matchReport(siteRules, doc);
        const matched = Object.entries(report)
          .filter(([, r]) => r.bySelector + r.byAnchor > 0)
          .map(([id]) => id);
        if (meta.kind === 'control') {
          expect(matched).toEqual([]);
        } else {
          for (const id of meta.expect) expect(matched, `rule ${id} should match in ${htmlFile}`).toContain(id);
        }
      });
    }
  }
});
