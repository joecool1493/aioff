#!/bin/sh
# Regenerates apps/ios (macOS + iOS Safari web extension) from the built Safari bundle.
# Needs full Xcode (not just Command Line Tools) and an Apple Developer account to ship.
# Apple renamed the tool in Xcode 26: safari-web-extension-packager. The old converter name is tried as a fallback.
set -eu
cd "$(dirname "$0")/.."
pnpm rules:build
pnpm --filter @aioff/extension build:safari
SRC="apps/extension/.output/safari-mv3"
[ -d "$SRC" ] || SRC="apps/extension/.output/safari-mv2"
TOOL="safari-web-extension-packager"
xcrun --find "$TOOL" >/dev/null 2>&1 || TOOL="safari-web-extension-converter"
xcrun "$TOOL" "$SRC" \
  --project-location apps/ios \
  --app-name "AI Off" \
  --bundle-identifier app.aioff.safari \
  --swift --copy-resources --no-open --no-prompt --force
echo "Xcode project written to apps/ios. Open it, set your team, and archive."
echo "Note: Safari has no storage.managed, so school lock state on iPad comes from MDM (com.apple.configuration.safari.extensions.settings) only."
