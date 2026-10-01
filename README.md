# LoText

A folder-based plain-text editor. One window is one folder; one file is open at a time.
No tabs, no preview pane, no split view — the app opens a folder, edits the files in it as
plain text, and prints them.

Electron shell, CodeMirror 6 editor, esbuild for the whole build step.

> **Status: in development.** The app builds and runs, but most of it has never been exercised.
> Much of it has been checked by script but not yet by hand; while that is under way the list
> is in `tasks/`.

## Getting started

You need **Node 20 or newer** (developed on 24) and macOS. Nothing else — Electron and esbuild
both arrive with `npm install`.

```sh
npm install     # once
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

Run `npm run watch` in one terminal and `electron .` in another. **A rebuild does not reload the
running app** — restart `electron .` to pick up changes. There is deliberately no reload
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

Shipping to the App Store is `packaging/app-store/ios.md`.

## Printing from the shell

The same layout and drawing code as ⌘P, with no window at all:

```sh
electron . --pdf notes.md --out notes.pdf --preset "Letterhead" --paper a4
electron . --pdf - --name notes.md < notes.md > notes.pdf    # - is stdin/stdout
electron . --list-presets
```

`npm run pdf` is the same thing with the build in front of it.

## Building a .dmg

```sh
npm run dmg                      # => exports/LoText-<version>.dmg, then asks about the Desktop
npm run dmg -- /path/out.dmg     # somewhere else
npm run dmg -- --desktop         # also copy it to the Desktop, without asking
npm run dmg -- --no-desktop      # no Desktop copy, without asking
```

`npm run release` also asks whether to publish the notarized image on lolekproductions.org
(`-- --publish` / `-- --no-publish` to say in advance). See `docs/publishing-the-mac-download.md`.

`scripts/make-dmg.sh` assembles the app bundle from the Electron one in `node_modules`, gives it
the icon in `assets/` and the document types in `packaging/`, signs it ad-hoc, and wraps it. No
packaging dependency — `plutil`, `codesign` and `hdiutil` do the whole job.

That image is **ad-hoc signed**: it runs here, because a locally built image is never
quarantined, but Gatekeeper refuses it on any machine it is copied to. The one to give to other
people is signed with the Developer ID certificate and notarized by Apple:

```sh
npm run release                  # in Terminal on the Mac, not over SSH
```

It checks the one-time setup first and says what is missing. The setup, and the traps that cost
hours the first time, are in [`discoveries/packaging-a-dmg.md`](discoveries/packaging-a-dmg.md).

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

LoText is being built to match the existing application at `~/Documents/Lolext` as closely as
possible. When a behavior is unclear — what ⌘B does to an already-bold span, how a print preset
lays out a table — read it there rather than inventing a reasonable default.
