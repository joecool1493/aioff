# Contributing to AI Off

The most valuable contribution is a rule. Platforms rename things constantly, and every fix here reaches every user within hours.

## Report an AI element

Easiest: in the extension popup choose **Pick an AI element**, click the element, then **Save and submit to AI Off rules**. That opens a prefilled GitHub issue with selector candidates and a text anchor. The page URL has its query string removed. Nothing is sent until you press Submit on GitHub.

## Write a rule

Rules live in `packages/rules/src/sites/<site>.json`. A minimal hide rule:

```json
{
  "id": "example-ask-ai-button",
  "kind": "hide",
  "selectors": ["button[data-testid='ask-ai']"],
  "textAnchors": ["Ask AI about this"],
  "anchorTarget": "control",
  "description": "The Ask AI button under every product photo",
  "since": "2026-09-20"
}
```

Guidelines:

- **Prefer stable attributes**: `data-*`, `aria-label`, `role`, `href` patterns, custom element names. Avoid generated class names (`css-1dbjc4n`, `x1lliihq`).
- **Add text anchors** when the feature has a visible label. If every selector dies in a redesign, the anchor keeps the rule alive. Anchors match the start of short text only, need at least two words, and must end on a word boundary.
- `anchorTarget`: `block` hides the nearest block container (panels), `control` hides the nearest button or link (buttons, tabs), `self` hides the text's own element. Use `anchorContainer` with a `closest()` selector when you need precision.
- **Fail safe.** A rule that matches nothing must do nothing. Never match `html`, `body`, `main`, or a bare tag. If hiding leaves an awkward empty box, target the container instead.
- Rules that many people would not want (GitHub Copilot is the example) take `"defaultEnabled": false`.
- `description` is user-facing: it appears in "Why is this hidden?". Plain words, no em dashes.
- Optional `x` holds source notes (`confidence`, `source`). The build strips it.

Other rule kinds: `urlRewrite` (add a query param when it is missing), `setCookie` (the site's own AI-off preference), `click` (last resort: press the site's own off switch once), `remove` (use sparingly). See `packages/rules/schema.json`.

## Fixtures and tests

Every adapter needs a fixture with the AI element present and a control fixture where nothing may match.

```bash
pnpm healthcheck -- --site <site-id> --capture           # logged-out sites: real capture, sanitized
pnpm healthcheck -- --site <site-id> --capture --headed  # watch it, solve a consent wall by hand
pnpm test
```

For sites behind a login, hand-write a small fixture from the real DOM and mark it `"kind": "synthetic"` in the `.json` beside it. Never commit personal data in a fixture.

## Licensing of sources

This project is MIT. Selectors are facts, but do not paste blocks from GPL or non-commercial lists. Note where a selector came from in the rule's `x.source`.

## Code changes

`pnpm test`, `pnpm -r typecheck`, and `pnpm check:copy` must pass. The product promises in `CLAUDE.md` are not negotiable: no AI, no telemetry, no new network calls without updating the privacy disclosures in the same PR.
