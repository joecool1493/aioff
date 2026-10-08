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
# The generated project needs three things the packager leaves out (found 2026-10-08):
# an App Store category, or the Mac upload is rejected; the encryption declaration, or
# TestFlight stops each build with a compliance question (AI Off uses only HTTPS and
# standard signature checks); and iOS 17 as the minimum, where Safari gained Ed25519.
PROJ="apps/ios/AI Off"
for plist in "$PROJ/macOS (App)/Info.plist" "$PROJ/iOS (App)/Info.plist"; do
  /usr/libexec/PlistBuddy -c "Add :LSApplicationCategoryType string public.app-category.utilities" "$plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "$plist" 2>/dev/null || true
done
sed -i '' 's/IPHONEOS_DEPLOYMENT_TARGET = 15.0;/IPHONEOS_DEPLOYMENT_TARGET = 17.0;/g' "$PROJ/AI Off.xcodeproj/project.pbxproj"
# iPhone only for now: the App Store requires iPad screenshots whenever an app runs on iPad.
sed -i '' 's/TARGETED_DEVICE_FAMILY = "1,2";/TARGETED_DEVICE_FAMILY = 1;/g' "$PROJ/AI Off.xcodeproj/project.pbxproj"
echo "Xcode project written to apps/ios with the category, encryption, and iOS 17 fixes applied."
echo "Archive and upload (signed in to Xcode under Settings, Accounts):"
echo "  xcodebuild -project \"$PROJ/AI Off.xcodeproj\" -scheme \"AI Off (iOS)\" -destination generic/platform=iOS -archivePath /tmp/aioff-ios.xcarchive CURRENT_PROJECT_VERSION=<build> -allowProvisioningUpdates archive"
echo "  xcodebuild -exportArchive -archivePath /tmp/aioff-ios.xcarchive -exportOptionsPlist scripts/safari-export.plist -exportPath /tmp/aioff-export-ios -allowProvisioningUpdates"
echo "  (same for the macOS scheme)"
echo "Note: Safari has no storage.managed, so school lock state on iPad comes from MDM (com.apple.configuration.safari.extensions.settings) only."
