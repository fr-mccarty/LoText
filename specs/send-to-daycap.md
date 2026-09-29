# Spec: Cut and Send to DayCap

*2026-09-28. Asked for by the user; there is nothing like it in Lolext.*

DayCap (DayCapture, lolekproductions.org/DayCapture) drops what it captures as files into one
folder. **Cut and Send to DayCap** puts selected text there too: the selection becomes a new
`.md` file in that folder, and leaves the document.

## Where it is

- **Mac:** the editor's right-click menu — Cut, Copy, Paste, then Cut and Send to DayCap. The
  items that need a selection are greyed out without one. A right-click inside the selection
  keeps it.
- **iPhone and iPad:** the editor's ⋯ menu, listed only while text is selected.

## What it does

1. Reads the selection: every range, joined by a newline.
2. Saves it, exactly as it is, as a new file in the DayCap folder, named for the moment:
   `LoText 2026-09-28 10.45.12.md` (`src/shared/daycap.js`). A name already taken becomes
   `…-2.md`, `…-3.md`; nothing is ever written over.
3. Only once the file is saved: takes the selection out of the document, as one edit that ⌘Z
   puts back, and puts the text on the clipboard. If the text or the selection changed while
   the file was being written, the document is left as it is.

A save that fails leaves the text where it was and says why in an alert. The file DayCap gets
stays even if the cut is undone.

## The folder

Settings ▸ Editor ▸ DayCap ▸ Folder, with Choose…. Until one is chosen, the first send asks for
it. The folder is **each device's own**: a path on the Mac (`dayCapFolder` in `lotext.json`), a
bookmark to a folder picked in Files on iOS (`dayCapBookmark` in the app's user defaults). It is
never synced through iCloud, never in an exported settings file, and Restore Defaults leaves it.
