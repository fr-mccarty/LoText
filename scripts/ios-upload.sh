#!/bin/bash
#
# Archive the iOS app and upload it to App Store Connect for TestFlight, from a terminal.
#
#   scripts/ios-upload.sh
#
# Bump MARKETING_VERSION / CURRENT_PROJECT_VERSION in ios/App/App.xcodeproj first: the build
# number must rise on every upload. Needs the Apple account signed in to Xcode (Settings ▸
# Accounts) and the login keychain unlocked — from an SSH-like session,
# `security unlock-keychain ~/Library/Keychains/login.keychain-db` typed by the user. Xcode
# manages signing: -allowProvisioningUpdates fetches the distribution certificate and profile.
# After the upload Apple processes the build (5–15 minutes) before TestFlight offers it.

set -euo pipefail
cd "$(dirname "$0")/.."

project=ios/App/App.xcodeproj
version=$(grep -m1 'MARKETING_VERSION = ' "$project/project.pbxproj" | sed 's/.*= \(.*\);/\1/')
build=$(grep -m1 'CURRENT_PROJECT_VERSION = ' "$project/project.pbxproj" | sed 's/.*= \(.*\);/\1/')
archive="$HOME/Library/Developer/Xcode/Archives/$(date +%Y-%m-%d)/LoText-$version-$build.xcarchive"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if ! security show-keychain-info "$HOME/Library/Keychains/login.keychain-db" >/dev/null 2>&1; then
  echo "✗ The login keychain is locked. Run: security unlock-keychain ~/Library/Keychains/login.keychain-db" >&2
  exit 1
fi

echo "▸ Building the web half and syncing it into the project"
npm run ios:build >/dev/null

echo "▸ Archiving LoText $version ($build)"
mkdir -p "$(dirname "$archive")"
xcodebuild archive -project "$project" -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$archive" -allowProvisioningUpdates \
  > "$work/archive.log" 2>&1 || { grep -E 'error:' "$work/archive.log" | head -20 >&2; echo "✗ Archive failed: $work/archive.log" >&2; trap - EXIT; exit 1; }

# The app may encrypt only through CryptoKit (packaging/app-store/ios.md).
otool -L "$archive/Products/Applications/App.app/App" | grep -q CryptoKit.framework \
  || echo "! CryptoKit is not linked — check the crypto rule in packaging/app-store/ios.md" >&2

cat > "$work/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>N6Z9A72885</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

echo "▸ Uploading to App Store Connect"
xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$work/ExportOptions.plist" \
  -exportPath "$work/export" -allowProvisioningUpdates 2>&1 | grep -E 'error|Upload succeeded|EXPORT' 

echo "✓ LoText $version ($build) uploaded. Add it to TestFlight once App Store Connect has processed it."
