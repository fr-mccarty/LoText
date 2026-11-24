# LoText

A folder-based plain-text editor. One window is one folder; one file is open at a time.
No tabs, no preview pane, no split view — the app opens a folder, edits the files in it as
plain text, and prints them.

Electron shell, CodeMirror 6 editor, esbuild for the whole build step.

> **Status:** the Mac app is released (see Installing). The iPhone/iPad and Android apps are in
> testing; Windows builds from source.

## Installing

**Mac** (macOS 11 Big Sur or later):

1. Download the latest disk image from [lolekproductions.org/LoText](https://lolekproductions.org/LoText).
2. Open the `.dmg` and drag **LoText** into **Applications**.
3. Open LoText from Applications. It is signed and notarized by Apple, so it opens without a
   warning.
4. **File → Open Folder…** (⌘O) and pick a folder of text files. That window belongs to that
   folder from then on.

To update, download the newer image and drag it into Applications again, replacing the old one.

**iPhone and iPad, Android:** submitted to the App Store (1.5) and Google Play (1.0.11) on
2026-11-24, awaiting review. Neither is offered in mainland China.

**Windows:** no download yet. Build the installer yourself on a Mac with `npm run windows` (see
[Building for Windows](#building-for-windows)). It is unsigned, so SmartScreen warns the first
time it runs.

## Getting started (from source)

Every build — Mac, Windows, iPhone, Android — is made on a Mac. You need **macOS** and
**Node 20 or newer** (developed on 24). Nothing else: Electron and esbuild both arrive with
`npm install`.

```sh
git clone https://github.com/fr-mccarty/LoText.git
cd LoText
npm install     # once; keeps the packages in node_modules.nosync, out of iCloud Drive
npm test        # optional: the test suite
npm start       # build, then launch
```

`npm start` is `npm run build && electron .`, so it always launches what is currently in `src/`.
The first launch opens an empty window: use **File → Open Folder…** (⌘O) to point it at a folder,
and that window belongs to that folder from then on.

For development use `npm run dev` instead:

```sh
npm run dev     # same, plus View → Toggle Developer Tools
```

The DevTools menu item is hidden unless `--dev` is passed, which is the only thing the flag does.

## The edit–run loop

The build is three separate bundles because three different worlds are involved: the main
process (Node), the preload bridge, and each window's script (browser). `build.mjs` writes them
all into `dist/`, and copies `src/html/` and the stylesheet alongside.

```sh
npm run watch   # esbuild rebuilds dist/ on every save
```

Run `npm run watch` in one terminal and `npx electron .` in another. **A rebuild does not reload the
running app** — restart `npx electron .` to pick up changes. There is deliberately no reload
shortcut: ⌘R is **Refresh**, which re-lists the folder in the sidebar and re-reads the open file.

`dist/` is generated. Never edit it, and never commit a fix there.

## Where the code lives

```
src/main/       the main process — windows, menu, IPC, session, settings, printing
  store/        the local disk store, and how a remote folder reaches its server (ssh)
  print/        the print window and the PDF writer
  viewers/      reading the formats that are not plain text
src/renderer/   one window's world — the model, and the views that ask it for things
  editor/       CodeMirror and the app's own six commands
  sidebar/      the file tree
  sheets/       Find File, Recent Folders, Connect to Server
  settings/     the Settings panel
src/shared/     code both sides run: markdown, print layout, file paths, settings, the stores'
                naming and walking, the remote folder store, text decoding, the document viewers
src/mobile/     the iOS app's stand-in for src/main/: the bridge, its store, and the bars and
                menus a phone needs around the renderer's views
ios/            the Xcode project (Capacitor); the native plugin is ios/App/App/LoTextNative*.swift
src/html/       the three HTML shells
```

The rule the layout is built on: a view asks the model, the model asks the bridge, and the bridge
is the only thing that touches the file system. Nothing in `src/renderer/` imports from
`src/main/`.

## iPhone and iPad

The same renderer runs on iOS in a Capacitor web view; `src/mobile/` stands in for `src/main/`
(`specs/mobile.md`). You need Xcode as well as Node.

```sh
npm run ios:build   # dist-mobile/, copied into ios/App
npm run ios:open    # …and open Xcode: run on a device, or Product ▸ Archive to ship
scripts/ios-sim.sh run        # or run pad — build, install and launch in the simulator
```

Shipping to the App Store is `packaging/app-store/ios.md` (fastlane, from the terminal).

## Printing from the shell

The same layout and drawing code as ⌘P, with no window at all:

```sh
npx electron . --pdf notes.md --out notes.pdf --preset "Letterhead" --paper a4
npx electron . --pdf - --name notes.md < notes.md > notes.pdf    # - is stdin/stdout
npx electron . --list-presets
```

`npm run pdf` is the same thing with the build in front of it.

Quit LoText first: it runs one copy at a time, so a command typed while the app is open quits
without doing anything. The same goes for `npm start` with the installed app running.

## Building for Android

```sh
brew install openjdk@21          # once: Gradle 8 cannot run on Android Studio's own Java 25
npm run android:run              # a debug build, installed on the running emulator or phone
npm run android:open             # the project in Android Studio
```

The same web half as the iPhone app, on its own native plugin in `android/`. Not on Android yet:
Connect to Server, iCloud sync and Send to DayCap. A Play Store build needs the upload key
(`scripts/android.sh release` makes the bundle); fastlane uploads it — `packaging/play-store/listing.md`.

## Building for Windows

```sh
brew install makensis            # once
npm run windows                  # => LoText-<version>-Setup.exe and LoText-<version>-win-x64.zip in the export folder
npm run windows -- arm64         # the same for Windows on Arm
```

Built on the Mac, unsigned: Windows SmartScreen warns on first launch until it is signed with a
Windows code-signing certificate.

## Building a .dmg

```sh
npm run dmg                      # => the export folder (scripts/export-folder.sh)
npm run dmg -- /path/out.dmg     # somewhere else
```

`npm run release` also asks whether to publish the notarized image on lolekproductions.org
(`-- --publish` / `-- --no-publish` to say in advance). Publishing reaches the website's host
over ssh, at the address in `.env` — copy `.env.example` to `.env` and fill it in.

`scripts/make-dmg.sh` assembles the app bundle from the Electron one in `node_modules`, gives it
the icon in `assets/` and the document types in `packaging/`, signs it ad-hoc, and wraps it. No
packaging dependency — `plutil`, `codesign` and `hdiutil` do the whole job.

That image is **ad-hoc signed**: it runs here, because a locally built image is never
quarantined, but Gatekeeper refuses it on any machine it is copied to. The one to give to other
people is signed with the Developer ID certificate and notarized by Apple:

```sh
npm run release                  # in Terminal on the Mac, not over SSH
```

It checks the one-time setup first — the Developer ID certificate and a saved notary login —
and says what is missing. It signs as Lolek Productions unless `.env` names another identity
(`LOTEXT_SIGN_IDENTITY`, `LOTEXT_NOTARY_PROFILE`; see `.env.example`), so to sign your own
build you need your own Apple Developer account.

## App state

Everything the app remembers — preferences, print presets, recent folders, the windows to put
back at the next launch, and the crash-recovery copies — lives in one place:

```
~/Library/Application Support/LoText/
  lotext.json     preferences, presets, recents, sessions
```

To test a first launch, delete that directory:

```sh
rm -rf ~/Library/Application\ Support/LoText
```

## A note on the reference app

LoText is built to match an earlier Swift app, Lolext, which is not public. Where LoText
departs from it on purpose, `CLAUDE.md` lists the departures.

## License

MIT — see [`LICENSE`](LICENSE).
