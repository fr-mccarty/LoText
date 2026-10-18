# LoText

A folder-based plain-text editor: Electron shell, CodeMirror 6, esbuild. One window is one
folder, one file is open at a time. The same renderer also ships as an iPhone/iPad app in a
Capacitor web view (`specs/mobile.md`). The README covers setup and layout; this file is what to
know before changing anything.

## Commands

```sh
npm run build      # esbuild → dist/ (main, preload, renderer, settings, print-window)
npm start          # build, then launch
npm run dev        # same, plus View → Toggle Developer Tools
npm test           # vitest run — tests live in test/
npm run dmg        # ad-hoc signed .app + .dmg → the export folder, scripts/export-folder.sh
                   # (runs on this Mac only)
npm run release    # Developer ID signed + notarized .dmg → the export folder — the user runs it at the Mac
                   # release then asks whether to publish it (scripts/publish-to-website.sh)
electron . --list-presets
electron . --pdf notes.md --out notes.pdf [--preset NAME] [--paper a4]

npm run web:build  # esbuild --web → dist-web/: the editor for lolekproductions.org/LoText
scripts/update-website-editor.sh # the same, copied into ~/peru's public folder to commit there
npm run ios:build  # esbuild --mobile → dist-mobile/, then cap sync into ios/
npm run ios:open   # the same, then open Xcode — archiving and uploading happen there
scripts/ios-sim.sh run [pad]     # build, install, launch in the simulator
scripts/ios-sim.sh eval 'js'     # drive it; also answer N, shot out.png, docs
```

A rebuild does not reload the running app — restart `electron .`. ⌘R is Refresh, not reload.

## Rules

- **Match the reference app.** LoText copies the Swift app at `~/Documents/Lolext`. When a
  behaviour is unclear, read it there (its UI tests in `LolextUITests/` are the clearest spec)
  rather than inventing a default. **Deliberate departures**, asked for by the user — do not
  "restore" them from Lolext:
  - No Toggle Comment (⌘/). `Mod-/` stays in `CLAIMED_BY_MENU` so CodeMirror cannot bind it.
  - A title-bar-high drag strip in the editor's colour tops the detail pane; the text starts
    below it.
  - LoText ▸ Export Settings… / Import Settings… in the menu, as well as in the panel.
  - Clicking a file in the sidebar keeps the keyboard in the sidebar (row stays blue, ⌘⌫
    deletes it); Enter on a row opens it and moves to the editor.
  - Text selection is a bright blue (`--text-selection`), not the system's muted `Highlight`.
  - ⇧⌘O is File ▸ Recently Edited…: the folder's files newest first by their modified date on
    disk (`src/main/store/recent.js`), not Lolext's Go to Last File, the list of files this
    window has opened. It is never greyed: with nothing to list it opens the picker, which says
    so. Lolext greys it and the key does nothing.
  - A save that fails on the way out of a file (switching, changing folder, closing the window)
    offers Save As… / Keep Editing instead of a bare OK. No Discard, on purpose. Lolext only
    has OK, which with a lost volume left no way out but quitting.
  - The open file vanishing or turning unreadable underneath the app raises no alert: a clean
    one closes to the empty state; an edited one keeps its text and asks only on ⌘S or leaving
    it. Lolext asked on every return to the window, and dismissing the alert is a return.
  - Moving onto a taken name lands as `name-2.ext`, `name-3.ext`, … rather than refusing.
  - Deleting on a volume with no Trash (an SMB share linked into the folder) asks "Delete
    immediately?" and removes it for good only on yes. Lolext only shows the Trash's error.
  - ⌘R (Refresh) re-reads the open file from disk, not just its stamp, so a server-side change
    that keeps the size and second still shows. Unsaved edits are never replaced by it.
  - Sidebar rows are moved with mouse events, not HTML5 drag and drop — see
    `discoveries/editor-and-window-pitfalls.md`.
  - A long line that starts with spaces or tabs wraps onto rows indented as far as its own text
    (`src/renderer/editor/hanging-indent.js`); Lolext wraps to the left edge. Drawing only — no
    spaces are added.
  - Return starts the new line with the previous line's leading spaces and tabs, exactly
    (`insertNewlineKeepingIndent` in `src/renderer/editor/line-editing.js`); Lolext indents
    nothing, and CodeMirror's own Return turned tabs into spaces.
  - Sidebar rows offer Copy Absolute Path, the item's full path on the clipboard, wherever the
    folder has a path on this Mac (not over SSH, not on iOS).
  - Reopening a file puts back its selection and top line. Optional iCloud sync carries settings,
    presets and those positions between Mac and iPhone/iPad through files in the iOS app's iCloud
    container, not Lolext's key-value store (`specs/icloud-sync.md`).
- **Never edit `dist/`, `dist-mobile/`, `dist-web/` or `ios/App/App/public/`.** They are generated.
- **The LoText web page runs the editor's own code** (`src/web/playground.js`): task boxes,
  enhanced tasks, arrows, the hanging indent, Tab, ⌥↑ / ⌥↓ and ⌘X. A change to any of those is
  not on the site until `scripts/update-website-editor.sh` is run and Peru is committed and deployed.
- **iOS is the same app with `src/mobile/` in place of `src/main/`** (`specs/mobile.md`). The
  model does not know which platform it is on: `src/mobile/bridge.js` answers every method
  `preload.js` has. Logic both need goes in `src/shared/` (the stores' naming, walk, recent,
  text coding, settings, document viewers, the remote store) — never copied. Renderer code may ask
  `bridge.platform === 'ios'` for wording only. iOS leaves out, on purpose: New Window, the CLI, Open in Finder, dragging rows (Move To… instead), and the folder watcher
  (the app re-checks on coming forward). Native code is one plugin, `ios/App/App/LoTextNative*.swift`
  and `FolderStore.swift`; a new Swift file must be added to `project.pbxproj`.
- **A folder on a server is one store with two transports** (`src/shared/store/remote-store.js`).
  The Mac runs `/usr/bin/ssh` and logs in with the Mac's own `~/.ssh` keys, LoText's own key
  last (`src/main/store/ssh-transport.js`); iOS runs SwiftNIO SSH in the app with a key of the
  device's own (`LoTextNative+SSH.swift`). See `discoveries/remote-folders.md`. **iOS
  encrypts only through Apple's CryptoKit**, which is what keeps `ITSAppUsesNonExemptEncryption`
  NO: add no Swift package that carries its own crypto (BoringSSL, OpenSSL, `_CryptoExtras`,
  Citadel) — `packaging/app-store/ios.md`.
- **Views ask the model, the model asks the bridge, the bridge touches the disk.** Nothing in
  `src/renderer/` imports from `src/main/`. `src/shared/` is code both sides run.
- **Paths are store-relative strings** (`src/shared/file-path.js`), `""` is the root — never
  absolute disk paths.
- **Do not add `"type": "module"`** to the root `package.json`: `dist/*.js` is CommonJS and
  Electron would load it as ESM. See `discoveries/test-setup.md`.
- **`node_modules` is a symlink to `node_modules.nosync`**, a name iCloud Drive skips. npm
  replaces the link with a real folder on every install; the `dependencies` script in
  `package.json` (`scripts/keep-node-modules-out-of-icloud.mjs`) moves it back. Install with
  scripts on — `--ignore-scripts` leaves the packages uploading to iCloud.
- **Keep the `yauzl` override.** electron's installer unzips with it, and the yauzl 2 that
  `extract-zip` asks for stops partway under Node 26, leaving electron without its app.
- **Stay on vitest 3.** vitest 5 needs esbuild 0.27+, which collides with the build's pinned
  esbuild 0.24.
- **The markdown dialect is deliberately small** (`src/shared/markdown/`): headings, paragraphs,
  tables, and inline emphasis. Links and blockquotes print literally on purpose — do not grow it
  into half a markdown implementation. Help ▸ Markdown Formatting (`src/renderer/sheets/help.js`)
  documents the dialect and draws its examples with the real parser; keep its wording in step.
- **Print layout is in points**, canvas measures in pixels. Convert with `pixelsToPoints()` in
  `src/shared/print/fonts.js`.
- **You cannot sign or notarize.** This session is effectively SSH: the keychain is locked and
  nothing can prompt for a password, so codesign fails with `errSecInternalComponent`. Ask the
  user to run `npm run release` in Terminal on the Mac; verify the result afterwards with
  `spctl --assess` / `stapler validate`, which work from here. The iOS app is archived and
  uploaded by the user in Xcode (`packaging/app-store/ios.md`). Simulator builds need no
  keychain, but must be built outside `~/Documents` (see `discoveries/running-lotext-on-ios.md`).
- **One instance at a time.** The app holds a single-instance lock; running the GUI and a CLI
  command together makes one of them quit.

## Where to look

- `specs/` — how a feature is meant to behave, written before it was built. Keep it in step
  when the behaviour changes. `tab-key.md`: Tab inserts spaces, 2 or 4.
  `mobile.md`: the iPhone/iPad app — layout, touch, what is left out.
  `enhanced-tasks.md`: `[[ ]] ==> (()) title` tasks, how LoText draws and edits them; the rules
  are the toolbox's `/Volumes/jam-dev-tools/jam-specs/enhanced-task/` and `enhanced-selection/`.
  `disclosures.md`: disclosure arrows — the first `-->` / `--v` (or `==>` / `==v` off a task
  line) anywhere on a line folds the lines deeper under it; the rule is the toolbox's
  `/Volumes/jam-dev-tools/jam-specs/disclosure-arrow/`.
  `task-boxes.md`: a `[ ]` / `[x]` at a line's head is a clickable box in any file.
  `icloud-sync.md`: optional iCloud sync of settings and reading positions.
  `send-to-daycap.md`: Cut and Send to DayCap — a selection saved as a new file in DayCap's folder.
  Help ▸ Enhanced Tasks and Help ▸ Disclosure Arrows (`src/renderer/sheets/help.js`) are the
  user-facing versions of those specs; keep their wording in step.
- `tasks/` — temporary: what is unverified and what is left, deleted once done. Nothing
  durable goes there — a lesson goes in `discoveries/`, a rule or decision in this file.
- `discoveries/` — write-ups of problems already solved. Read the relevant one before
  debugging; add one when something non-obvious costs you time.
  - `running-and-screenshotting-lotext.md` — how to drive the app and capture windows without
    Playwright, and the traps in doing so.
  - `editor-and-window-pitfalls.md` — bugs already fixed and why they happened: CodeMirror's
    base theme, ⌥-arrows vs the menu, grid layout, and how the editor was checked against Lolext.
  - `packaging-a-dmg.md` — building, signing and notarizing; first-time release setup; which
    Apple certificate is which.
  - `remote-folders.md` — why Connect to Server never worked (an unquoted path, `-i` hiding
    the Mac's keys, a save check that always failed), and testing against a throwaway sshd.
  - `recently-edited-speed.md` — what made ⇧⌘O slow (listing a network share's folders one at
    a time), how it was measured, and why there is no cache.
  - `running-lotext-on-ios.md` — the simulator harness (`scripts/ios-sim.sh`), answering native
    alerts from a terminal, and the codesign-under-Documents trap.
- `docs/` — how-to documents for people. `publishing-the-mac-download.md`: exporting the
  signed disk image, where the images are kept, and replacing the download on lolekproductions.org.
- `packaging/app-store/` — the App Store listings: `metadata.md` (Mac), `ios.md` (iPhone/iPad,
  and the archive-and-upload steps).
- App state: `~/Library/Application Support/LoText/lotext.json`. Delete the directory to test a
  first launch. On iOS the same file is in the app container's `Library/Application Support/
  LoText/`; `xcrun simctl uninstall` gives a first launch.
