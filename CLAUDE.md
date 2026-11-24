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
npm run windows    # Windows installer + portable zip → the export folder, built on the Mac
                   # (-- arm64 for Windows on Arm); needs `brew install makensis`
electron . --list-presets
electron . --pdf notes.md --out notes.pdf [--preset NAME] [--paper a4]

npm run web:build  # esbuild --web → dist-web/: the editor for lolekproductions.org/LoText
scripts/update-website-editor.sh # the same, put live: committed in Peru on the Mac mini, websites rebuilt
npm run ios:build  # esbuild --mobile → dist-mobile/, then cap sync into ios/
npm run ios:open   # the same, then open Xcode — archiving and uploading happen there
scripts/ios-upload.sh            # archive and upload to TestFlight from here (keychain unlocked)
scripts/ios-sim.sh run [pad]     # build, install, launch in the simulator
scripts/ios-sim.sh eval 'js'     # drive it; also answer N, shot out.png, docs
npm run android:build            # esbuild --mobile → dist-mobile/, cap sync android, a debug APK
npm run android:run              # the same, installed and launched on the running emulator
npm run android:open             # the same, then open Android Studio
scripts/android.sh shot out.png  # the emulator's screen
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
    disk (`src/shared/store/recent.js`), not Lolext's Go to Last File, the list of files this
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
  - Sidebar rows are moved with mouse events, not HTML5 drag and drop.
  - A long line that starts with spaces or tabs wraps onto rows indented as far as its own text
    (`src/renderer/editor/hanging-indent.js`); Lolext wraps to the left edge. Drawing only — no
    spaces are added.
  - Return starts the new line with the previous line's leading spaces and tabs, exactly
    (`insertNewlineKeepingIndent` in `src/renderer/editor/line-editing.js`); Lolext indents
    nothing, and CodeMirror's own Return turned tabs into spaces.
  - Sidebar rows offer Copy Absolute Path, the item's full path on the clipboard, wherever the
    folder has a path on this Mac (not over SSH, not on iOS).
  - Several sidebar rows can be selected: ⌘-click (Ctrl-click on Windows) adds or removes one,
    ⇧-click and ⇧↑ / ⇧↓ take a range, Esc goes back to one. ⌫ / ⌘⌫ delete them all (one
    question, by count), dragging one moves them all, and the row menu over them offers Delete
    N Items (and Move N Items To… on iOS). `selectedPath` stays the main row; setting it alone
    makes it the only one.
  - View ▸ Show Hidden Files (⇧⌘., and a toggle in Settings), off by default. One switch for
    every store (`setHiddenFilesShown` / `isListed` in `src/shared/store/names.js`), set in
    `src/main/main.js` and `src/mobile/bridge.js` from the view settings; `.icloud` placeholders
    are never listed.
  - A task box is any `[ ]` / `[x]` standing apart from its words, anywhere on a line
    (`specs/task-boxes.md`), not only at the head.
  - Enhanced tasks are written `[ ] ==> ( ) title`, single brackets, not jam-spec's `[[ ]]` /
    `(( ))`: `[[` is a wiki link (`specs/wiki-links.md`) — typing it opens the file picker
    narrowed to the open file's folder, and ⌘-click on `[[path]]` opens that file — a plain
    tap does on a touch screen. `[text](https://…)` is the external link: the same click opens it
    in the system's browser. Either written backwards (`]]…[[`, `(…)[…]`) shows its brackets red.
  - Reopening a file puts back its selection and top line. Optional iCloud sync carries settings,
    presets and those positions between Mac and iPhone/iPad through files in the iOS app's iCloud
    container, not Lolext's key-value store (`specs/icloud-sync.md`).
- **Never edit `dist/`, `dist-mobile/`, `dist-web/` or `ios/App/App/public/`.** They are generated.
- **The LoText web page runs the editor's own code** (`src/web/playground.js`): task boxes,
  enhanced tasks, arrows, the hanging indent, Tab, ⌥↑ / ⌥↓, ⌘X and external links. A change to any of those is
  not on the site until `scripts/update-website-editor.sh` is run. The public sites are served
  from the Mac mini's `~/peru-2/behavior/code` by `pnpm websites:install`, not by `pnpm deploy`
  (the droplet). `scripts/peru.sh` says how; it reaches the Mac mini over ssh at
  `LOTEXT_PERU_HOST` in `.env` (gitignored — copy `.env.example`).
- **iOS is the same app with `src/mobile/` in place of `src/main/`** (`specs/mobile.md`). The
  model does not know which platform it is on: `src/mobile/bridge.js` answers every method
  `preload.js` has. Logic both need goes in `src/shared/` (the stores' naming, walk, recent,
  text coding, settings, document viewers, the remote store) — never copied. Renderer code may ask
  `bridge.platform === 'ios'` for wording only. iOS leaves out, on purpose: New Window, the CLI, Open in Finder, dragging rows (Move To… instead), and the folder watcher
  (the app re-checks on coming forward). Native code is one plugin, `ios/App/App/LoTextNative*.swift`
  and `FolderStore.swift`; a new Swift file must be added to `project.pbxproj`.
- **Android is the iOS app's web half on a Java LoTextNative**
  (`android/app/src/main/java/com/lolekproductions/lotext/LoTextNativePlugin.java` and
  `FolderStore.java`), answering the same methods with the same shapes. `bridge.platform` is
  `android` there; `src/mobile/` asks it only to leave out what Android has no native half for
  yet — Connect to Server, iCloud sync, Send to DayCap — and the renderer only for wording.
  A picked folder is a document tree (no paths, only document ids), the app's own folder plain
  files in the app's storage; deleting is for good, and the question says so. Back is the page's
  (`goBack` in `src/mobile/ui.js`). Gradle 8 needs Java 21, not Android Studio's 25:
  `scripts/android.sh` sets it.
- **A folder on a server is one store with two transports** (`src/shared/store/remote-store.js`).
  The Mac runs `/usr/bin/ssh` and logs in with the Mac's own `~/.ssh` keys, LoText's own key
  last (`src/main/store/ssh-transport.js`); iOS runs SwiftNIO SSH in the app with a key of the
  device's own (`LoTextNative+SSH.swift`). **iOS
  encrypts only through Apple's CryptoKit**, which is what keeps `ITSAppUsesNonExemptEncryption`
  NO: add no Swift package that carries its own crypto (BoringSSL, OpenSSL, `_CryptoExtras`,
  Citadel) — `packaging/app-store/ios.md`.
- **Views ask the model, the model asks the bridge, the bridge touches the disk.** Nothing in
  `src/renderer/` imports from `src/main/`. `src/shared/` is code both sides run.
- **Paths are store-relative strings** (`src/shared/file-path.js`), `""` is the root — never
  absolute disk paths.
- **Do not add `"type": "module"`** to the root `package.json`: `dist/*.js` is CommonJS and
  Electron would load it as ESM.
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
- **Signing needs the keychain unlocked first.** This session is effectively SSH: the keychain
  starts locked and nothing can prompt for a password, so codesign fails with
  `errSecInternalComponent`. Ask the user to type `! security unlock-keychain
  ~/Library/Keychains/login.keychain-db` in the prompt; after that `npm run release` (Mac, signed
  and notarized) and `scripts/ios-upload.sh` (archive and upload to TestFlight) both work from
  here. Verify a Mac release with `spctl --assess` / `stapler validate`. Simulator builds need no
  keychain, but must be built outside `~/Documents` (`scripts/ios-sim.sh` does): codesign fails
  on the extended attributes iCloud Drive puts on files there.
- **Windows is the Mac app with a different frame** (`src/main/chrome.js`): an ordinary title
  bar and menu bar, opaque backgrounds, Settings and Exit at the foot of File, About in Help.
  `CmdOrCtrl` accelerators; the renderer spells shortcuts and names (Recycle Bin, File Explorer)
  through `src/renderer/platform.js` — write ⌘ in strings and pass them through `keys()`.
  SSH is Windows' own `System32\OpenSSH\ssh.exe`, without multiplexing; iCloud sync is off.
  `scripts/make-windows.sh` builds it with no Wine: resedit brands the exe, Homebrew's makensis
  builds `packaging/windows/installer.nsi`. **Unsigned**, so SmartScreen warns on first run.
- **One instance at a time.** The app holds a single-instance lock; running the GUI and a CLI
  command together makes one of them quit.

## Where to look

- `specs/` — how a feature is meant to behave, written before it was built. Keep it in step
  when the behaviour changes. `tab-key.md`: Tab inserts spaces, 2 or 4.
  `mobile.md`: the iPhone/iPad app — layout, touch, what is left out.
  `enhanced-tasks.md`: `[ ] ==> ( ) title` tasks (single brackets, unlike jam-spec), how LoText draws and edits them; the rules
  are jam-spec's [`jam-spec/enhanced-task/`](https://github.com/fr-mccarty/jam-spec/tree/main/enhanced-task/) and
  [`enhanced-selection/`](https://github.com/fr-mccarty/jam-spec/tree/main/enhanced-selection/).
  `disclosures.md`: disclosure arrows — the first `-->` / `--v` (or `==>` / `==v` off a task
  line) anywhere on a line folds the lines deeper under it; the rule is jam-spec's
  [`jam-spec/disclosure-arrow/`](https://github.com/fr-mccarty/jam-spec/tree/main/disclosure-arrow/).
  `task-boxes.md`: a `[ ]` / `[x]` anywhere on a line, standing apart from its words, is a
  clickable box in any file.
  `wiki-links.md`: `[[` picks a file under the open file's folder; ⌘-click a `[[link]]` opens it.
  `icloud-sync.md`: optional iCloud sync of settings and reading positions.
  `send-to-daycap.md`: Cut and Send to DayCap — a selection saved as a new file in DayCap's folder.
  Help ▸ Enhanced Tasks and Help ▸ Disclosure Arrows (`src/renderer/sheets/help.js`) are the
  user-facing versions of those specs; keep their wording in step.
- `packaging/app-store/` — the App Store listings: `metadata.md` (Mac), `ios.md` (iPhone/iPad,
  and the archive-and-upload steps). `packaging/play-store/listing.md` is the Google Play one,
  and says where the Play upload key lives: `~/.config/lotext/upload.jks` on the M5 MacBook Pro,
  with its password in the gitignored `android/keystore.properties`. Never commit either.
- App state: `~/Library/Application Support/LoText/lotext.json`. Delete the directory to test a
  first launch. On iOS the same file is in the app container's `Library/Application Support/
  LoText/`; `xcrun simctl uninstall` gives a first launch.
