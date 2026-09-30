# Building the Firefox add-on from this source package

This package is the whole repository minus test fixtures, research notes, and other apps. The
extension lives in `apps/extension` and depends on the workspace packages next to it.

Requirements: Node.js 24 or newer, pnpm 12 (run `corepack enable` once, or `npm install -g pnpm`).

```bash
pnpm install --frozen-lockfile
pnpm --filter @aioff/extension build:firefox
```

The build is written to `apps/extension/.output/firefox-mv3/` and matches the submitted add-on
file byte for byte.

Do not run `pnpm rules:build` before building. The rules feed the extension embeds is included
here as `packages/rules/dist/rules.json`; its version string and `generatedAt` field carry the
date of our build, so a fresh rules build on another day would produce different bytes. The rules
sources (`packages/rules/src`) and the build script that produced that file are included for
inspection.

Tools used, all open source and run locally: WXT (bundler), Vite, esbuild, React, TypeScript, pnpm.
