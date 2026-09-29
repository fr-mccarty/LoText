# LoText on iPhone and iPad

Written before it was built. The iOS app is the same renderer — the model, CodeMirror, the
sidebar, the sheets, the print layout — running in a Capacitor web view, with `src/main/`
replaced by `src/mobile/`. The rule the desktop app is built on still holds: a view asks the
model, the model asks the bridge, and the bridge is the only thing that touches the disk. On the
Mac the bridge is `preload.js` over IPC; on iOS it is `src/mobile/bridge.js` over one native
plugin, `LoTextNative` (`ios/App/App/LoTextNative.swift`).

## What is left out, on purpose

- **Connect to Server.** iOS apps cannot run `ssh`. No menu item, no sheet, no recent servers.
- **New Window.** One scene, one folder. iPad multi-window may come later.
- **The command line** (`--pdf`, `--list-presets`) and **Open in Finder**.
- **Drag to move** in the sidebar. A touch cannot be told apart from a scroll soon enough; rows
  are moved with *Move To…* in the row menu instead. (With an iPad trackpad the Mac's drag works.)
- **The folder watcher.** iOS has no FSEvents for a folder another app vends. The tree and the
  open file are checked when the app comes forward, and by Refresh — which is how a server folder
  already works on the Mac.

## The folder

The unit of work is still one folder. It is named in one of two ways:

- **Choose Folder…** — the system folder picker. It reaches On My iPhone, iCloud Drive and any
  file provider the user has installed. The folder is kept as a bookmark, so it reopens after a
  relaunch without being picked again.
- **The LoText folder** — the app's own Documents directory, which the Files app shows as
  *On My iPhone ▸ LoText*. It is opened automatically on first launch, so the first screen is a
  folder rather than a button. It is a convenience, never a fence: same store, same rules.

Folder ▸ button in the sidebar lists both, and the recent folders, as one menu.

## Layout

The window width decides, not the device:

- **Regular** (≥ 700 px — iPad, most of the time): sidebar and editor side by side, as on the Mac.
  The split is dragged with a finger. The sidebar toggle is in the editor's bar.
- **Compact** (< 700 px — iPhone, iPad Slide Over): one pane at a time. The file list is the first
  screen; tapping a file opens it and slides to the editor; the back button returns to the list.
  Going back **saves**, the same as leaving a file does on the Mac.

A bar tops each pane in place of the Mac's drag strip. The sidebar's bar has the Mac's four
buttons plus Find File, Recently Edited and a ⋯ menu (Settings, the three Help pages). The
editor's bar has the file's name, its unsaved dot, Find, and a ⋯ menu with what the Mac keeps in
File, Edit and Format: Save, Print…, Share PDF…, Bold, Italic, Find and Replace, Duplicate, Close
File.

## Touch

- **Tap** a file to open it; tap a folder to twirl it. Long-press a row for its menu (the Mac's
  right-click menu, minus Open in Finder, plus Move To…). The menus are the system's action sheets.
- **The keyboard bar** sits above the on-screen keyboard while the editor has it: Tab, ⇧Tab,
  a task box, Bold, Italic, Undo, Redo, and a button to put the keyboard away. Tab is what makes
  tasks, disclosures and indentation work, and the on-screen keyboard has none.
- **A hardware keyboard** gets the Mac's shortcuts (⌘S, ⌘N, ⌘P, ⇧⌘P, ⇧⌘O, ⌘F, ⌘B, ⌘I, ⌘W, ⌘R,
  ⌘+/⌘−/⌘0, ⌘,).

## Saving

Unchanged, with the platform's words for the occasions: a file saves on ⌘S (or Save in the ⋯
menu), when the app goes to the background — iOS's focus loss — and on leaving the file. The
working save (recovery copy) works exactly as on the Mac. A save that fails on the way out offers
Save As…, which on iOS is the system's export picker.

## Deleting

Deleting asks by name. iOS moves the file to *Recently Deleted* where the location keeps one
(iCloud Drive, On My iPhone); where it does not, the item is removed. The alert says both.

## Printing

The same layout code draws the pages in a hidden frame; the native side turns each page into a
PDF page and hands the document to AirPrint. Share PDF… hands the same document to the share
sheet — Save to Files, Mail, Messages.

## Viewers

Images and documents (.docx, .odt, .rtf, .xlsx, .pptx, iWork previews) show in the pane as on
the Mac. Audio and video play in the pane. A PDF opens in Quick Look.

## Settings

The Mac's Settings panel, shown as a full-screen sheet with a Done button. Export and Import use
the system's document pickers. Settings on the phone are the phone's own until iCloud sync is
turned on (Settings ▸ iCloud, on each device): then the Editor tab, the print presets and where
each iCloud Drive document was left travel between the phone and the Mac (`icloud-sync.md`).
The DayCap folder is never synced — it is each device's own.
