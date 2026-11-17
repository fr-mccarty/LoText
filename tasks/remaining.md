# LoText — what remains

Temporary: delete this folder when the list is empty. Nothing here is durable. Lessons live in
`discoveries/`, rules and decisions in `CLAUDE.md`.

Everything below is a **try-it-by-hand** check in the running app (`npm start`). The build, the
98 tests, the CLI, packaging and notarized release are done. Where a note says *scripted*, the
logic was driven by the harness in `discoveries/running-and-screenshotting-lotext.md`, but
nobody has clicked it yet.

## Opening and editing
- [ ] Click a file: it opens, the row highlights, the window title follows it.
- [ ] Type: the dirty dot appears; ⌘S saves; the dot clears; the file on disk changed.
- [ ] ⌘W closes the file and leaves the folder open. ⇧⌘W closes the window.
- [ ] ⌘D, ⌘X (cut line), ⌘B, ⌘I, ⌥↑/⌥↓. *Logic matches Lolext and is tested; ⌥↑/⌥↓ scripted.*
- [ ] Find: ⌘F, ⌥⌘F replace, ⌘G / ⇧⌘G, ⌘E use selection.
- [ ] Undo across a save; undo after switching files and back.
- [ ] Drag the window by the strip above the text.
- [ ] Tab / ⇧Tab with 2 and 4 spaces (`specs/tab-key.md`). *Scripted.*
- [ ] Help ▸ Enhanced Tasks, Help ▸ Disclosure Arrows and Help ▸ Markdown Formatting open as
      sheets; the try-it areas work (arrows, boxes, ⌥↑/⌥↓); Esc and Done close them. *Scripted.*
- [ ] Enhanced tasks (`specs/enhanced-tasks.md`): click `==>` / `==v` on a task (it hides
      the lines indented under it), click and type into the `  [ ] ` choices, check
      the task's `[[ ]]` (it collapses, one ⌘Z restores), Find into hidden text.
- [ ] Disclosure arrows (`specs/disclosures.md`): the first `-->` / `--v` or `==>` / `==v`
      anywhere on a line folds the lines deeper under it, nested; a blank or differently indented line ends a body;
      `<!-- x -->` stays plain; typing an arrow writes `--v` / `==v`. *Scripted.*
- [ ] Sidebar ▸ Copy Absolute Path on a file and on a folder puts its full path on the clipboard.
- [ ] Read Help ▸ Enhanced Tasks and Help ▸ Disclosure Arrows against the app: every claim holds.
- [ ] Task boxes (`specs/task-boxes.md`): click `[ ]` / `[x]` at a line's head to flip it; `[]`
      typed there becomes `[ ]`. *Scripted.*

## Added 2026-11-17 — never clicked
- [ ] View ▸ Show Hidden Files (⇧⌘.) and the Settings toggle: dot files appear and go, twirled
      folders stay open; ⇧⌘P and ⇧⌘O follow it; a server folder too. Off on a first launch.
- [ ] Boxes anywhere: `ring [ ] then [x]` — each box flips on its own; `a[x]` and `[[x]]` stay text.
- [ ] Enhanced tasks as `[ ] ==> ( ) title`: arrow, checking collapses, choices, ⌥↑/⌥↓, ⌘X.
- [ ] Type `[[` in a file in a subfolder: the picker lists only that folder and below, by path
      from there; ↩ writes `[[sub/file.md]]`, caret after; Esc leaves `[[`; one ⌘Z undoes.
- [ ] Hold ⌘ over a `[[link]]`: underline and pointer. ⌘-click opens it; a missing one alerts.
- [ ] Sidebar ⌘-click / ⇧-click / ⇧↓ select several; ⌫ asks once and trashes them all; drag
      moves them all; right-click offers Delete N Items; Esc goes back to one.
- [ ] iPhone and Android: tap a `[[link]]` — it opens; long-press on one still selects, a drag
      over one still scrolls.
- [ ] iOS / iPad: Move N Items To… with several selected (trackpad ⌘-click); Settings toggle.
- [ ] Website editor: run `scripts/update-website-editor.sh` so the site has the new boxes and
      single-bracket tasks, then commit and deploy Peru.

## Sidebar
- [ ] New File ⌘N, New Folder ⇧⌘N, Duplicate ⇧⌘D, Rename (extension not pre-selected), Delete.
- [ ] Drag a file into a folder, out of one (onto the folder's name or empty space), Esc to cancel. *Scripted.* Drop from Finder is not implemented.
- [ ] Drag a row to the sidebar's bottom or top edge: the list scrolls, faster nearer the edge, and stops when the pointer moves away. *Scripted.*
- [ ] Twirl a folder open, ⌘R, and expansion and scroll survive.
- [ ] Right-click menu on a file, a folder, and a dimmed binary row.
- [ ] ⇧⌘B hides and shows the sidebar. *Scripted.*

- [ ] New Folder: the name is selected and typing renames it, even as the watcher redraws the tree. *Scripted.*

## Sheets
- [ ] Find File ⇧⌘P: arrow keys and Enter open the file. *Ranking scripted.*
- [ ] Go to Last File ⇧⌘O.
- [ ] Recent Folders menu, and Clear Menu.
- [ ] Connect to Server ⇧⌘K against a real SSH host: list, read, write, key setup. *Never run.*

## Viewers
- [ ] A zip, a document (.docx/.pdf text), an image, a PDF, and a file with no viewer — each
      shows something sensible, never the editor.

## Settings ⌘,
- [ ] The Editor and Printing tabs never change each other's values.
- [ ] A change shows in every open window at once.
- [ ] ⌘= / ⌘- / ⌘0 font size survives a relaunch.
- [ ] Dark mode follows the system.
- [ ] The panel keeps its scroll position while you change things. *Scripted.*
- [ ] Export and Import, from the panel and from the LoText menu. *Panel round-trip scripted.*

## Printing ⌘P
- [ ] Print a markdown file and compare with Lolext page by page: margins, letterhead, headers,
      footers, page numbers, tables.
- [ ] Presets: create, duplicate, rename, switch, delete.

## Session and recovery
- [ ] Quit with two windows on different folders; relaunch; both return with the same file,
      expansion and scroll.
- [ ] Kill the app with unsaved changes; relaunch; see what recovery offers.
- [ ] Double-click a `.md` in Finder while the app runs: it goes to the window that owns the
      folder, not a new one. *Cold launch with a file scripted.*
- [ ] Install the notarized `.dmg` on another Mac and open it.

## iOS — by hand, on a real iPhone and iPad (TestFlight)

What the simulator could not check. Everything in `discoveries/running-lotext-on-ios.md` ▸ *What
was checked* was scripted there.
- [ ] Choose Folder… with a folder in iCloud Drive: it opens, lists, edits, saves; after a
      relaunch it reopens without being picked again. The same with a third-party provider.
- [ ] A file in iCloud Drive that is not downloaded yet: listed under its own name, opens.
- [ ] Real taps: long-press a row (menu, not a text selection); scroll the list without
      opening the menu; drag the split on iPad with a finger.
- [ ] Typing on the on-screen keyboard: caret, selection handles, autocorrect off in the
      buffer; the keyboard bar stays above the keys when rotating.
- [ ] Tap a task box and a disclosure arrow with a finger.
- [ ] Print to a real printer; Share PDF… to Files and Mail.
- [ ] Save As… from a failed save (the export picker); Export / Import Settings.
- [ ] iPad with a hardware keyboard: ⌘S, ⌘N, ⇧⌘P, ⇧⌘O, ⌘F, ⌘B, ⌘Z; trackpad right-click
      opens the row menu.
- [ ] Split View / Slide Over on iPad switches between the two layouts cleanly.
- [ ] Video and audio play in the pane.
- [ ] A real hardware ⌘X on a collapsed task and on a collapsed disclosure: the item goes whole
      and pastes back whole. *The page's side was scripted in the simulator; iOS handing the
      key to the page, and the clipboard taking it, were not.*
- [ ] Cut and Send to DayCap after deleting the chosen DayCap folder in Files: the alert names
      it, Choose… opens the picker, the note lands in the new folder. *Logic tested; the
      picker cannot be driven from the harness.*

## iCloud sync (`specs/icloud-sync.md`)
*Scripted on the Mac against a fake container, and on the simulator (not signed in to iCloud).
Never run against real iCloud.*
- [ ] iPhone signed in to iCloud: turn it on; Settings says "On". Then on the Mac,
      `~/Library/Mobile Documents/iCloud~com~lolekproductions~lotext/Sync/` appears and the Mac's
      switch goes from "Waiting for iCloud" to "On. Shared with iPhone."
- [ ] Change the font size on one; it follows on the other after the app comes forward.
- [ ] A file in iCloud Drive, left mid-way on the Mac, opens at the same place on the iPhone.
- [ ] Reopening any file (sync off) lands where it was left, on both platforms.
- [ ] Letterhead images (Printing ▸ Letterhead ▸ Header image / Footer image): Choose… on the
      Mac (open panel) and on iOS (Photos / Files); a big photo shrinks and is kept; height and
      Left/Centre/Right change the printed page; Remove. *Printing with images checked in a
      Mac PDF; the Choose… picker and printing on iOS not yet.*
- [ ] A preset with images, made on one device, prints the same on the other after sync.
