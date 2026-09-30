# AI Off

One switch that removes AI from your browser, your computer, your phone, and your network, with a maintained rules feed that keeps it working as platforms change.

> We build AI. Here is the switch.

**AI Off contains no AI.** Every decision is a rule, a word list, a selector, a domain list, or a label that a file or a platform puts on itself. No models, no "smart" detection, no telemetry, no account.

## What is in this repo

| Path | What it is | State |
|---|---|---|
| `apps/extension` | The browser extension (WXT, MV3, React). The Switch, the four-level dial, counter, pause controls, element picker, options, managed mode for schools. | Builds for Chrome, Edge, Firefox, Safari. Verified end to end in real Chromium. |
| `packages/rules` | **The product.** Rules feed: JSON Schema, one source file per site, fixtures, tests, build, Ed25519 signing. | 55 sites, 207 site rules plus 2 network tiers. 11 sites verified against live pages. |
| `packages/core` | Rule engine: matching, hiding with text-anchor fallback, keyword muting, DNR compiler, stats, feed verification, provenance scanner, offline licenses. | Unit tested. |
| `packages/ui` | Shared React components: Switch, Dial, Counter, RuleExplainer. | Used by extension and companion. |
| `packages/policies` | Catalog of browser policies, Windows registry tweaks, macOS restriction keys, and a 77-item app checklist, plus generators for .reg, plist, .mobileconfig, Linux JSON, Google Admin, Intune, Jamf, Firefox. | Unit tested. Plists pass `plutil -lint`. |
| `packages/dns` | 235 DNS-verified AI domains in two tiers, exported to 10 formats, with a never-block guard. | Unit tested. |
| `apps/companion` | Desktop companion (Tauri v2): applies policies, journals and reverts exactly, verifies after OS updates, checklist, offline license, global hotkey for a physical switch. | Compiles with zero warnings; `tauri build` produces a macOS .dmg that launches. Unsigned. Windows build not started. |
| `apps/site` | Landing site (Astro, static, zero third-party requests): the giant switch, "what we hide" generated from the ruleset, computer and phone checklists generated from the policy catalog, schools page with a policy builder, pricing, thank-you page, privacy, network lists, launch post. | Builds. 11 pages. |
| `apps/workers` | Three Cloudflare Workers: payment webhook to license key (Stripe or Lemon Squeezy, with email and a pickup endpoint), zero-knowledge settings sync in R2, and hosted school config with Exam Mode. | Typecheck. Not deployed. |
| `tools/healthcheck` | Playwright nightly runner, fixture capture, GitHub issue opener, and a real-browser end-to-end test of the built extension. | Run live on 2026-09-20. |
| `tools/picker` | Stable selector generator behind the element picker. | Unit tested. |

Every platform mechanism (policy names, registry keys, selectors, store rules) was verified against vendor documentation or live sites before it was built; the notes behind that are the maintainers' and are not in this repository. Where a claim is unproven, the site and the extension say so.

## Quick start

```bash
pnpm install
pnpm rules:build          # validate + assemble packages/rules/dist/rules.json
pnpm test                 # 129 tests
pnpm ext:build            # Chrome, Firefox, Edge, Safari bundles in apps/extension/.output
```

Load `apps/extension/.output/chrome-mv3` as an unpacked extension (chrome://extensions, Developer mode), or `firefox-mv3` as a temporary add-on (about:debugging).

```bash
pnpm ext:dev                                  # extension with hot reload
pnpm site:dev                                 # landing site
pnpm healthcheck                              # live check of every public site
pnpm healthcheck -- --capture                 # also save sanitized fixtures
pnpm --filter @aioff/healthcheck e2e          # load the built extension into Chromium and test it on live sites
pnpm --filter @aioff/healthcheck blocked      # the Level 4 blocked page, against an AIOFF_ALL_SITES=1 AIOFF_OUT_DIR=.output-allsites build
pnpm --filter @aioff/healthcheck screenshots  # store screenshots from live pages into docs/store
pnpm --filter @aioff/healthcheck proof -- --headed  # the full proof run in a real browser: live sites, the Switch, a signed-feed tamper test
pnpm --filter @aioff/companion tauri build    # macOS app (needs Rust: brew install rust)
pnpm dns:build && pnpm policies:build         # blocklists and the policy pack
pnpm check:copy                               # house style gate (no em dashes)
```

## The five promises

1. **No AI inside.** Not for convenience, not for detection.
2. **Zero telemetry.** The only network calls are listed in `apps/extension/lib/constants.ts` and on the privacy page. Pro sync is opt-in and zero-knowledge.
3. **Open rules, open core.** MIT.
4. **Hide, do not break.** Every rule fails safe; one click pauses a site.
5. **Reversible in one click.** The Switch restores everything instantly, without a reload. The end-to-end test asserts this.

## How a fix ships

1. Someone reports a new AI button (the element picker opens a prefilled issue) or the nightly health check opens a `rule-broken` issue.
2. Edit one JSON file under `packages/rules/src/sites/`, capture or update a fixture, open a PR. CI validates the schema, lints for dangerous selectors, and runs the fixtures.
3. Merge. `rules-build-and-sign` signs the feed and publishes it. Every installed extension picks it up within 6 hours, verifies the signature, and refuses anything older or unsigned. No store review.

## License

MIT. See `LICENSE`.
