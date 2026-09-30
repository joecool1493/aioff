# @aioff/rules: the rules feed

This package is the actual product. It can be split into its own public repository (`off-rules`) with `git subtree split --prefix=packages/rules` whenever that is useful; the extension only needs the published `rules.json` and `rules.json.sig`.

- `schema.json`: JSON Schema for the feed.
- `src/sites/*.json`: one file per site. `src/mute.json`, `src/provenance.json`, `src/network.json`, `src/host-groups.json`.
- `fixtures/<site>/`: `.html` plus a `.json` that says whether it is `captured`, `synthetic`, or `control`, and which rules must match.
- `scripts/build.ts`: assemble, validate, lint, prune expired rules, write `dist/`.
- `scripts/keygen.ts`, `scripts/sign.ts`, `scripts/verify.ts`: Ed25519 signing.

## Signing

```bash
pnpm rules:keygen prod        # writes keys/rules-prod.private.pem (gitignored) and appends the public key to public-keys.json
```

Store the PEM as the GitHub secret `AIOFF_RULES_PRIVATE_KEY`, then move the file offline. Commit `public-keys.json`. The extension embeds every listed public key and accepts a feed signed by any of them, which is how rotation works: add the new key in one extension release, start signing with it in the next, remove the old key after that. Remove the `dev` key before the first store release.

The extension rejects a feed with a bad signature, a feed older than the one it has, and a feed whose `minExtensionVersion` is newer than itself. On any rejection it keeps the last good ruleset.
