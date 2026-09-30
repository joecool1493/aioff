#!/usr/bin/env node
// House style gate: no em dashes anywhere in copy, docs, or rules. Runs in CI.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.output', '.wxt', '.astro', 'target', 'healthcheck-report', 'fixtures', 'research', 'keys']);
const EXTS = new Set(['.ts', '.tsx', '.mjs', '.js', '.json', '.md', '.astro', '.css', '.html', '.yml', '.yaml', '.rs', '.toml', '.sh', '.py']);
const SKIP_FILES = new Set(['HANDOFF.md', 'pnpm-lock.yaml']);
const bad = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXTS.has(extname(name))) {
      const lines = readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.includes(String.fromCharCode(0x2014))) bad.push(`${p}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
  }
}
walk(process.cwd());
if (bad.length) {
  console.error(`Em dashes found (${bad.length}). House style: never use them.\n` + bad.join('\n'));
  process.exit(1);
}
console.log('copy check passed: no em dashes');
