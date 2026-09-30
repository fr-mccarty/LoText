#!/bin/bash
# Build LoText for the iOS simulator and drive it from a terminal.
# See discoveries/running-lotext-on-ios.md.
#
#   scripts/ios-sim.sh build              web bundle + cap sync + xcodebuild (Debug, simulator)
#   scripts/ios-sim.sh run [device]       build, install, launch        (device: phone | pad | UDID)
#   scripts/ios-sim.sh launch [device]    relaunch what is installed
#   scripts/ios-sim.sh eval 'js' [device] run JS in the page (async body; `return` a value)
#   scripts/ios-sim.sh answer N [device]  choose button N on the alert or sheet on screen (-1 Cancel)
#   scripts/ios-sim.sh shot out.png [device]
#   scripts/ios-sim.sh docs [device]      print the app's Documents path (the LoText folder)
#
# `eval` works in Debug builds only: MainViewController polls tmp/lotext-eval.js in the app's
# container, runs it, and writes the answer to tmp/lotext-eval.out.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE=com.lolekproductions.lotext
# Not under ~/Documents: files there carry Finder extended attributes, and codesign refuses a
# bundle that has them ("resource fork, Finder information, or similar detritus").
DERIVED="${LOTEXT_DERIVED:-$HOME/Library/Developer/Xcode/DerivedData/LoText-ios}"
APP="$DERIVED/Build/Products/Debug-iphonesimulator/App.app"

device () {
  case "${1:-phone}" in
    phone) name='iPhone 17 Pro' ;;
    pad) name='iPad Pro 11-inch (M5)' ;;
    *) echo "$1"; return ;;
  esac
  xcrun simctl list devices available | grep -F "    $name (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'
}

boot () {
  local udid="$1"
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
}

build () {
  (cd "$ROOT" && npm run -s ios:build >/dev/null)
  xcodebuild -project "$ROOT/ios/App/App.xcodeproj" -scheme App -configuration Debug \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DERIVED" build \
    | grep -E 'error:|BUILD (SUCCEEDED|FAILED)' || true
  [ -d "$APP" ] || { echo "No app was built." >&2; exit 1; }
}

container () {
  xcrun simctl get_app_container "$1" "$BUNDLE" data
}

command="${1:-}"; shift || true
case "$command" in
  build) build ;;
  run)
    udid="$(device "${1:-phone}")"
    build
    boot "$udid"
    xcrun simctl terminate "$udid" "$BUNDLE" 2>/dev/null || true
    xcrun simctl install "$udid" "$APP"
    xcrun simctl launch "$udid" "$BUNDLE" >/dev/null
    echo "$udid"
    ;;
  launch)
    udid="$(device "${1:-phone}")"
    xcrun simctl terminate "$udid" "$BUNDLE" 2>/dev/null || true
    xcrun simctl launch "$udid" "$BUNDLE" >/dev/null
    ;;
  eval)
    udid="$(device "${2:-phone}")"
    tmp="$(container "$udid")/tmp"
    rm -f "$tmp/lotext-eval.out"
    printf '%s' "$1" > "$tmp/lotext-eval.js.part" && mv "$tmp/lotext-eval.js.part" "$tmp/lotext-eval.js"
    for _ in $(seq 1 120); do
      if [ -f "$tmp/lotext-eval.out" ]; then cat "$tmp/lotext-eval.out"; echo; exit 0; fi
      sleep 0.25
    done
    echo "No answer — is a Debug build running?" >&2; exit 1
    ;;
  answer)
    "$0" eval "return await Capacitor.Plugins.LoTextNative.answer({ index: ${1:-0} })" "${2:-phone}"
    ;;
  shot)
    udid="$(device "${2:-phone}")"
    xcrun simctl io "$udid" screenshot "$1" >/dev/null 2>&1
    echo "$1"
    ;;
  docs)
    echo "$(container "$(device "${1:-phone}")")/Documents"
    ;;
  *)
    sed -n '2,15p' "$0"; exit 1 ;;
esac
