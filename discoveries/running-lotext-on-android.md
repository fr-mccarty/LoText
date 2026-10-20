# Running LoText on Android

*2026-10-18, JAM-MBP---2021 (Apple M1 Pro, macOS 27.0.1), Android Studio with SDK 37 and its emulator*

## Java: 21 for Gradle, not Android Studio's 25

Capacitor 8's project is on Gradle 8.14, which cannot read Java 25's class files:

```
BUG! exception in phase 'semantic analysis' … Unsupported class file major version 69
```

Android Studio bundles Java 25, so both the command line and Studio failed. Homebrew's
`openjdk@21` fixes it. `scripts/android.sh` sets `JAVA_HOME` to it; for Android Studio this Mac
has `org.gradle.java.home=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` in
`~/.gradle/gradle.properties` (or set Settings ▸ Build Tools ▸ Gradle ▸ Gradle JDK once).

### Setting up the M5 MacBook Pro (2026-10-20)

Android releases are built on the M5 MacBook Pro ("Josh's MacBook Pro"), which also holds the
Play upload key (`packaging/play-store/listing.md`). From a fresh clone it needed only
`brew install openjdk@21 fastlane` and `npm install`; the first `scripts/android.sh build`
downloaded SDK Platform 36 and Build-Tools 35 itself. It has no `~/.gradle/gradle.properties`,
so Android Studio's Gradle JDK must be set to Java 21 in its Settings before building there.

## The emulator from a terminal

```sh
S=~/Library/Android/sdk
$S/emulator/emulator -list-avds
nohup $S/emulator/emulator -avd Medium_Phone_API_37.0 -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect > /tmp/lotext-emulator.log 2>&1 &
$S/platform-tools/adb shell getprop sys.boot_completed   # 1 once it is up
npm run android:run
scripts/android.sh shot /tmp/screen.png
```

Driving it: `adb shell input tap X Y`, `input text "a%sb"` (`%s` is a space), `input keyevent 4`
(Back), `66` (Enter). Coordinates are the screen's own pixels (1080 × 2400 on this AVD), not a
scaled screenshot's.

**Text in the page is invisible to `uiautomator dump`**; native dialogs, the folder picker and
the print dialog are not. To find a native button by its label:

```sh
adb shell uiautomator dump /sdcard/u.xml && adb shell cat /sdcard/u.xml | grep -o 'text="Delete"[^>]*bounds="[^"]*"'
```

**Never type `-->` through `adb shell input text`**: the device's shell reads it as a redirect.

The app's own folder is `files/Documents` inside the app: `adb shell run-as
com.lolekproductions.lotext ls files/Documents`. A picked folder is ordinary shared storage, e.g.
`adb shell cat /sdcard/Documents/Notes/todo.txt`.

## A long press opened two menus

Android's web view fires `contextmenu` when a finger is held down; iOS's does not. The mobile
shell already opens a row's menu itself after a long press (`watchTouches` in
`src/mobile/ui.js`), so the sidebar's own `contextmenu` handler opened a second, identical one
underneath — visible only after answering the first. In the text it would have put the Mac's
menu over Android's selection bar. A `contextmenu` from a touch is now stopped from reaching the
page's handlers, with its default left alone so Android still selects the word. Counting the
app's windows is how it showed:

```sh
adb shell dumpsys window windows | grep -cE 'Window\{[0-9a-f]+ u0 com.lolekproductions.lotext'
```

## Back

Without a handler Android's Back closed the app from inside a file. LoTextNative takes Back and
says `backButton`; the page goes back a step (`goBack` in `src/mobile/ui.js`) and calls `leave`
only when there is nowhere left to go.
