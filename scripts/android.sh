#!/bin/bash
# Build LoText for Android and drive it from a terminal. See specs/mobile.md.
#
#   scripts/android.sh build        web bundle + cap sync + a debug APK
#   scripts/android.sh run          build, install and launch on the running emulator or device
#   scripts/android.sh shot out.png the screen, as a PNG
#   scripts/android.sh release      a release App Bundle (.aab) for Google Play → the export folder
#
# Gradle 8 cannot run on Android Studio's own Java 25, so it is given Homebrew's Java 21
# (`brew install openjdk@21`). Android Studio needs telling once too: Settings ▸ Build, Execution,
# Deployment ▸ Build Tools ▸ Gradle ▸ Gradle JDK — or `org.gradle.java.home` in
# ~/.gradle/gradle.properties, which this Mac has.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
source "$ROOT/scripts/export-folder.sh"

JDK=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
[ -d "$JDK" ] || { echo "No Java 21 — run: brew install openjdk@21" >&2; exit 1; }
export JAVA_HOME="$JDK"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
APP_ID=$(node -p "require('./capacitor.config.json').appId")
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"

sync () {
  node build.mjs --mobile >/dev/null 2>"${TMPDIR:-/tmp}/lotext-android-build.log" || {
    cat "${TMPDIR:-/tmp}/lotext-android-build.log" >&2; exit 1; }
  npx cap sync android >/dev/null
  # As for iOS: npm keeps the packages in node_modules.nosync, and the link is the stable name.
  sed -i '' 's#node_modules\.nosync/#node_modules/#' android/capacitor.settings.gradle
}

case "${1:-build}" in
  build)
    sync
    (cd android && ./gradlew assembleDebug -q)
    echo "✓ $APK"
    ;;
  run)
    "$0" build
    "$ADB" install -r "$APK" >/dev/null
    "$ADB" shell am start -n "$APP_ID/.MainActivity" >/dev/null
    echo "✓ launched on $("$ADB" get-serialno)"
    ;;
  shot)
    "$ADB" exec-out screencap -p > "${2:?usage: android.sh shot out.png}"
    echo "✓ $2"
    ;;
  release)
    sync
    (cd android && ./gradlew bundleRelease -q)
    VERSION=$(node -p "require('./package.json').version")
    mkdir -p "$EXPORTS"
    cp android/app/build/outputs/bundle/release/app-release.aab "$EXPORTS/LoText-$VERSION-android.aab"
    echo "✓ $EXPORTS/LoText-$VERSION-android.aab (unsigned until a signing key is set up)"
    ;;
  *)
    echo "usage: android.sh build | run | shot out.png | release" >&2
    exit 1
    ;;
esac
