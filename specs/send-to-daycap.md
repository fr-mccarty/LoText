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
2. Saves it, exactly as it is, as a new file in the DayCap folder, named the way DayCap names
   its own captures (`DropzoneHelper.makeFilename` in `~/Documents/DayCap`), with `note` as the
   kind: `2026-09-28T10:45:12-daycap-note.md` (`src/shared/daycap.js`). Local time, date first,
   so the folder lists in time order among DayCap's audio, photos and video. A name already
   taken becomes `…-note-01.md`, `…-note-02.md`, as DayCap's `uniqueURL` does; nothing is ever
   written over.
3. Only once the file is saved: takes the selection out of the document, as one edit that ⌘Z
   puts back, and puts the text on the clipboard. If the text or the selection changed while
   the file was being written, the document is left as it is.

A save that fails leaves the text where it was and says why in an alert. The file DayCap gets
stays even if the cut is undone.

## The folder

DayCap has no fixed folder of its own: the iPhone keeps a bookmark to whichever folder the user
picked, and suggests `iCloud Drive/DayCap`, its iCloud container
(`~/Library/Mobile Documents/iCloud~org~lolekproductions~daycap/Documents` on the Mac). So LoText
asks too: Settings ▸ Editor ▸ DayCap ▸ Folder, with Choose…. Until one is chosen, or when the
chosen one is no longer there, a send asks for it, opening at DayCap's iCloud folder when this
Mac has it. The folder is **each device's own**: a path on the Mac (`dayCapFolder` in `lotext.json`), a
bookmark to a folder picked in Files on iOS (`dayCapBookmark` in the app's user defaults). It is
never synced through iCloud, never in an exported settings file, and Restore Defaults leaves it.
