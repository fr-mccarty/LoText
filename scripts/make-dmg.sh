#!/bin/bash
#
# Build LoText.app and wrap it in a disk image.
#
#   scripts/make-dmg.sh                      → LoText-<version>.dmg in the export folder
#                                              (scripts/export-folder.sh)
#   scripts/make-dmg.sh /path/to/out.dmg     → there instead
#   scripts/make-dmg.sh --publish            … and publish it on lolekproductions.org
#   scripts/make-dmg.sh --no-publish         … and do not, without asking
#
# Publishing is scripts/publish-to-website.sh, and is offered only for a notarized image: an
# ad-hoc one would be refused by every Mac that downloaded it. With neither flag, a run in a
# terminal asks, and a run with no terminal to answer in (an agent, a script) does not publish.
#
# Signing is chosen by the environment:
#
#   LOTEXT_SIGN_IDENTITY    a codesign identity, e.g. "Developer ID Application: Lolek
#                           Productions, INC. (N6Z9A72885)". Unset means ad-hoc.
#   LOTEXT_NOTARY_PROFILE   a `xcrun notarytool store-credentials` profile name. Set, the image
#                           is notarized and stapled. Needs a Developer ID identity.
#
# There is no packaging dependency on purpose. An Electron app bundle is a copy of the Electron
# bundle with the app's own files, name and identifiers put into it, and the tools to do that —
# plutil, codesign, hdiutil — are already on the machine. electron-builder would bring a large
# dependency tree to perform the same twenty lines.
#
# With neither set the result is **ad-hoc signed, not notarized**: fine to run here, because a
# locally built disk image is never quarantined, but Gatekeeper will refuse it on any machine it
# is copied to. Distributing it means both.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
source "$ROOT/scripts/export-folder.sh"

APP_NAME=$(node -p "require('./package.json').productName")
VERSION=$(node -p "require('./package.json').version")
OUT=""
PUBLISH=ask
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=yes ;;
    --no-publish) PUBLISH=no ;;
    -*) echo "Unknown option: $arg" >&2; exit 1 ;;
    *) OUT=$arg ;;
  esac
done
if [ -z "$OUT" ]; then
  mkdir -p "$EXPORTS"
  OUT="$EXPORTS/$APP_NAME-$VERSION.dmg"
fi

# The bundle identifier lives in package.json, not here. macOS keys a great deal off it — the
# icon cache, the single-instance lock, which app the Finder thinks a document belongs to — so
# two builds sharing an identifier are one app as far as the system is concerned, and changing
# it is a decision about identity rather than a detail of packaging.
BUNDLE_ID=$(node -p "require('./package.json').bundleId || ''")
[ -n "$BUNDLE_ID" ] || { echo "package.json has no \"bundleId\"." >&2; exit 1; }

IDENTITY=${LOTEXT_SIGN_IDENTITY:--}
NOTARY_PROFILE=${LOTEXT_NOTARY_PROFILE:-}
if [ "$PUBLISH" = yes ] && [ -z "$NOTARY_PROFILE" ]; then
  echo "Only a notarized image can be published: use 'npm run release -- --publish'." >&2
  exit 1
fi
if [ -n "$NOTARY_PROFILE" ] && [[ "$IDENTITY" != "Developer ID Application:"* ]]; then
  echo "Notarizing needs a Developer ID Application identity in LOTEXT_SIGN_IDENTITY." >&2
  exit 1
fi

ELECTRON="$ROOT/node_modules/electron/dist/Electron.app"
[ -d "$ELECTRON" ] || { echo "No Electron in node_modules — run npm install first." >&2; exit 1; }

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/lotext-dmg.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
APP="$STAGE/dmg/$APP_NAME.app"

echo "▸ Building $APP_NAME $VERSION"
# esbuild reports its bundle sizes on stderr, which is noise on a successful run and the only
# useful thing there is on a failing one — so it is held and printed only if the build fails.
if ! npm run build >/dev/null 2>"$STAGE/build.log"; then
  cat "$STAGE/build.log" >&2
  exit 1
fi

# ── The bundle ───────────────────────────────────────────────────────────────
mkdir -p "$STAGE/dmg"
cp -R "$ELECTRON" "$APP"
RES="$APP/Contents/Resources/app"
mkdir -p "$RES/dist"

# The source maps are two thirds of dist/ and serve only a debugger, so they stay behind.
for f in "$ROOT"/dist/*; do
  case "$f" in *.map) ;; *) cp -R "$f" "$RES/dist/" ;; esac
done

# Written from the real package.json rather than copied, so the shipped metadata cannot drift
# from the repo's, and so devDependencies and scripts do not travel with the app.
node -e '
  const p = require("./package.json")
  const { name, productName, version, description, main, author, license } = p
  process.stdout.write(JSON.stringify(
    { name, productName, version, description, main, author, license }, null, 2) + "\n")
' > "$RES/package.json"

mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$APP_NAME"

PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleExecutable        -string "$APP_NAME"  "$PLIST"
plutil -replace CFBundleName              -string "$APP_NAME"  "$PLIST"
plutil -replace CFBundleDisplayName       -string "$APP_NAME"  "$PLIST"
plutil -replace CFBundleIdentifier        -string "$BUNDLE_ID" "$PLIST"
plutil -replace CFBundleShortVersionString -string "$VERSION"  "$PLIST"
plutil -replace CFBundleVersion           -string "$VERSION"   "$PLIST"

# The icon. CFBundleIconFile names it without the extension.
rm -f "$APP/Contents/Resources/electron.icns"
cp "$ROOT/assets/icon.icns" "$APP/Contents/Resources/$APP_NAME.icns"
plutil -replace CFBundleIconFile -string "$APP_NAME" "$PLIST"

# What the Finder may hand the app. macOS sends `open-file` events only for declared types, so
# without this a double-click never reaches src/main/open-queue.js at all.
plutil -replace CFBundleDocumentTypes -xml "$(cat "$ROOT/packaging/document-types.plist")" "$PLIST"
plutil -lint "$PLIST" >/dev/null

# ── Signing ──────────────────────────────────────────────────────────────────
# Two things bite here. codesign refuses a bundle carrying extended attributes, which `cp -R`
# brings across from node_modules; and a bundle staged under a directory with a restrictive
# umask comes out owner-only, which runs for whoever built it and for nobody else.
chmod -RN "$APP" 2>/dev/null || true
chmod -R go+rX "$APP"
chmod 755 "$APP" "$APP/Contents/MacOS/$APP_NAME"
xattr -cr "$APP"

ENTITLEMENTS="$ROOT/packaging/entitlements.plist"
if [ "$IDENTITY" = "-" ]; then
  echo "▸ Signing (ad-hoc)"
  SIGN=(codesign --force --sign - --timestamp=none)
else
  # A real identity gets what notarization demands: the hardened runtime, a secure timestamp,
  # and the entitlements V8 needs to run under that runtime at all.
  echo "▸ Signing as $IDENTITY"
  SIGN=(codesign --force --sign "$IDENTITY" --timestamp --options runtime)
fi

# codesign narrates every replacement on stderr, so that is held and shown only on a failure.
sign () {
  "${SIGN[@]}" "$@" 2>"$STAGE/sign.log" || { cat "$STAGE/sign.log" >&2; exit 1; }
}

# Inside-out: a signature covers what is inside the bundle, so re-signing a nested piece after
# its container would invalidate the container. First every loose Mach-O inside Frameworks —
# the dylibs and the crashpad handler, which notarization rejects if they keep Electron's own
# signature; then the helper apps and frameworks, which sit side by side with none inside
# another; then the app.
find "$APP/Contents/Frameworks" -type f -perm -u+x -print0 |
  while IFS= read -r -d '' target; do
    if file -b "$target" | grep -q Mach-O; then sign "$target"; fi
  done
find "$APP/Contents/Frameworks" -maxdepth 1 \( -name "*.app" -o -name "*.framework" \) -print0 |
  while IFS= read -r -d '' target; do
    case "$target" in
      *.app) sign --entitlements "$ENTITLEMENTS" "$target" ;;
      *)     sign "$target" ;;
    esac
  done
sign --entitlements "$ENTITLEMENTS" "$APP"
codesign --verify --deep --strict "$APP"

# ── Does it run? ─────────────────────────────────────────────────────────────
# --list-presets exercises the packaged main process end to end — it loads the bundled code,
# reads the settings store and exits — without needing a window or a display.
echo "▸ Smoke test"
"$APP/Contents/MacOS/$APP_NAME" --list-presets >/dev/null

# ── The image ────────────────────────────────────────────────────────────────
echo "▸ Building the disk image"
ln -sf /Applications "$STAGE/dmg/Applications"
rm -f "$OUT"
hdiutil create -volname "$APP_NAME $VERSION" -srcfolder "$STAGE/dmg" -ov -format UDZO "$OUT" >/dev/null
[ "$IDENTITY" = "-" ] || codesign --force --sign "$IDENTITY" --timestamp "$OUT"

# ── Notarizing ───────────────────────────────────────────────────────────────
# The image, not the app: notarizing the container covers everything in it, and stapling the
# ticket to the image lets Gatekeeper pass it offline. The app inside carries no ticket of its
# own: once it is dragged out, Gatekeeper looks its notarization up online on first launch.
if [ -n "$NOTARY_PROFILE" ]; then
  echo "▸ Notarizing (this takes a few minutes)"
  if ! xcrun notarytool submit "$OUT" --keychain-profile "$NOTARY_PROFILE" --wait \
       --output-format json >"$STAGE/notary.json"; then
    cat "$STAGE/notary.json" >&2
    exit 1
  fi
  if ! grep -q '"status" *: *"Accepted"' "$STAGE/notary.json"; then
    cat "$STAGE/notary.json" >&2
    ID=$(node -p "require('$STAGE/notary.json').id")
    xcrun notarytool log "$ID" --keychain-profile "$NOTARY_PROFILE" >&2 || true
    exit 1
  fi
  xcrun stapler staple "$OUT" >/dev/null
fi

# Verify what actually shipped, from inside the image, rather than what was staged.
MOUNT=$(mktemp -d "${TMPDIR:-/tmp}/lotext-verify.XXXXXX")
hdiutil attach "$OUT" -nobrowse -quiet -mountpoint "$MOUNT"
codesign --verify --deep --strict "$MOUNT/$APP_NAME.app"
if [ -n "$NOTARY_PROFILE" ]; then
  spctl --assess --type open --context context:primary-signature "$OUT"
  spctl --assess --type execute "$MOUNT/$APP_NAME.app"
fi
"$MOUNT/$APP_NAME.app/Contents/MacOS/$APP_NAME" --list-presets >/dev/null
hdiutil detach "$MOUNT" -force -quiet
rmdir "$MOUNT" 2>/dev/null || true

echo "✓ $OUT ($(du -h "$OUT" | cut -f1))"

[ -n "$NOTARY_PROFILE" ] || exit 0
if [ "$PUBLISH" = ask ]; then
  PUBLISH=no
  if [ -t 0 ]; then
    read -r -p "Publish it on lolekproductions.org? [y/N] " ANSWER
    case "$ANSWER" in [yY]*) PUBLISH=yes ;; esac
  fi
fi
if [ "$PUBLISH" = yes ]; then
  bash "$ROOT/scripts/publish-to-website.sh" "$OUT"
fi
