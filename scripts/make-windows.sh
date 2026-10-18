#!/bin/bash
# The Windows app, built on this Mac: an installer and a portable zip in the export folder.
#
#   npm run windows                       → LoText-<version>-Setup.exe and LoText-<version>-win-x64.zip
#   npm run windows -- arm64              → the same for Windows on Arm
#
# The same recipe as make-dmg.sh — Electron's own build, LoText's dist/ dropped into it — with
# Electron's Windows zip in place of Electron.app. scripts/windows-exe.mjs fetches that and
# gives the exe its icon and version; Homebrew's makensis (`brew install makensis`) builds the
# installer from packaging/windows/installer.nsi. Nothing runs under Wine.
#
# **Unsigned.** Without a Windows code-signing certificate, SmartScreen warns on first launch
# ("Windows protected your PC" ▸ More info ▸ Run anyway). The build has not been run on Windows
# by anyone yet.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
source "$ROOT/scripts/export-folder.sh"

ARCH=${1:-x64}
case "$ARCH" in x64|arm64) ;; *) echo "Unknown architecture: $ARCH (x64 or arm64)" >&2; exit 1 ;; esac

command -v makensis >/dev/null || { echo "No makensis — run: brew install makensis" >&2; exit 1; }

APP_NAME=$(node -p "require('./package.json').productName")
VERSION=$(node -p "require('./package.json').version")
mkdir -p "$EXPORTS"
SETUP="$EXPORTS/$APP_NAME-$VERSION-Setup$([ "$ARCH" = x64 ] || echo "-$ARCH").exe"
ZIP="$EXPORTS/$APP_NAME-$VERSION-win-$ARCH.zip"

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/lotext-win.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
APP="$STAGE/$APP_NAME"

echo "▸ Building $APP_NAME $VERSION for Windows ($ARCH)"
if ! npm run build >/dev/null 2>"$STAGE/build.log"; then
  cat "$STAGE/build.log" >&2
  exit 1
fi

# ── The app folder ───────────────────────────────────────────────────────────
echo "▸ Electron for Windows"
ELECTRON_ZIP=$(node --no-deprecation scripts/windows-exe.mjs electron "$ARCH")
mkdir -p "$APP"
unzip -q "$ELECTRON_ZIP" -d "$APP"
mv "$APP/electron.exe" "$APP/$APP_NAME.exe"
rm -f "$APP/resources/default_app.asar"

RES="$APP/resources/app"
mkdir -p "$RES/dist"
for f in "$ROOT"/dist/*; do
  case "$f" in *.map) ;; *) cp -R "$f" "$RES/dist/" ;; esac
done
node -e '
  const p = require("./package.json")
  const { name, productName, version, description, main, author, license } = p
  process.stdout.write(JSON.stringify(
    { name, productName, version, description, main, author, license }, null, 2) + "\n")
' > "$RES/package.json"

echo "▸ Icon and version"
node scripts/windows-exe.mjs brand "$APP/$APP_NAME.exe" "$STAGE/$APP_NAME.ico"

# ── The two downloads ────────────────────────────────────────────────────────
echo "▸ Portable zip"
rm -f "$ZIP"
(cd "$STAGE" && zip -qry "$ZIP" "$APP_NAME")

echo "▸ Installer"
rm -f "$SETUP"
makensis -V2 \
  -DAPP_NAME="$APP_NAME" -DVERSION="$VERSION" \
  -DSOURCE="$APP" -DICON="$STAGE/$APP_NAME.ico" -DOUT="$SETUP" \
  "$ROOT/packaging/windows/installer.nsi"

echo "✓ $SETUP ($(du -h "$SETUP" | cut -f1))"
echo "✓ $ZIP ($(du -h "$ZIP" | cut -f1))"
