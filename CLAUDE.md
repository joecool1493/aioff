# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo. The product spec, the decision log (what was verified against vendor docs, and every deviation), and the launch checklist live in the maintainers' private notes; ask before large changes.

## Non-negotiables

- **No AI of any kind** in the product: no LLM calls, no on-device models, no embeddings, no classifiers. Rules, word lists, selectors, domain lists, and declared provenance only.
- **No network calls** beyond the ones in `apps/extension/lib/constants.ts` (signed rules feed; Level 3 lists; managed org config; opt-in Pro sync). No analytics, no crash reporting. Adding a call means updating the privacy page and the About tab in the same change.
- **Never use em dashes** in copy, docs, comments, or rules. `pnpm check:copy` enforces it.
- **Rules are data.** Site fixes belong in `packages/rules/src/sites/*.json`, not in code. If a fix seems to need code, the engine is missing a rule kind: add it to the schema, types, engine, and tests together.
- **Hide, do not break.** Prefer `hide` over `remove`. Never target `html`, `body`, `main`, or bare tag selectors (the linter rejects them). Single-word text anchors are not allowed.
- Platform mechanisms (policy names, registry keys, settings paths) change. **Verify against current vendor docs before implementing** and log what you found in the pull request and the decision log.

## Commands

- `pnpm test` (vitest; happy-dom by default, jsdom for the rules fixtures because happy-dom mishandles descendant combinators inside `:has()`).
- `pnpm -r typecheck`, `pnpm check:copy`, `pnpm rules:build`, `pnpm ext:build`.
- `pnpm --filter @aioff/healthcheck e2e` after `pnpm ext:build` for a real-browser check.
- `pnpm --filter @aioff/healthcheck blocked` for the Level 4 page, against a test build made with `AIOFF_ALL_SITES=1 AIOFF_OUT_DIR=.output-allsites` (automation cannot accept the optional permission prompt, so that flag bakes all-sites access into the manifest; never set it for a release build).

## Definition of done for an adapter

Rule set with descriptions and `since` dates; a fixture with the AI element present (captured beats synthetic; label synthetic ones honestly in the `.json` next to the `.html`); a control fixture where nothing may match; a healthcheck entry with a reliable trigger URL where the site works logged out; a manual look in Chrome and Firefox.

## Layout notes

- Packages are consumed as TypeScript source (`exports` points at `src/`). No package build step.
- `packages/rules/scripts/load.ts` assembles the ruleset for both the build and the tests. Network tiers come from `packages/dns/src/domains.json` (single source of truth).
- The content script must stay small. Never import `@aioff/rules` from it; matches are injected in `wxt.config.ts`.
- The companion's Rust side is a thin executor. Put knowledge in `@aioff/policies` where it is tested.

## Commit style

Small commits, imperative subject, explain the why in the body when it is not obvious.
