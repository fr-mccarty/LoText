# Spec: wiki links

A `[[path]]` in any file is a link to another file in the opened folder. It is plain text, saved
as written; the editor only colours it and lets it take a ⌘-click. There is nothing like it in
Lolext: the user asked for it.

## Reading a link

- A link is `[[`, a target with no brackets and no line break, and `]]`. `[[]]` is not one.
- The target is a path **from the folder the file holding the link is in**: in `notes/today.md`,
  `[[plan.md]]` is `notes/plan.md` and `[[week/mon.md]]` is `notes/week/mon.md`. Links reach down
  only — a `..` is dropped, as every path in the app drops it.
- The target is the file's whole name, extension and all.

## External links

- `[[…]]` is the internal link, to a file. The external one is Markdown's `[text](address)`:
  the address a web or mail one — `https://…`, `http://…`, `mailto:…`, or `www.…` (read as
  `https://www.…`). Anything else in the round brackets, a file path included, makes no link.
- It is coloured like a wiki link and followed the same way (⌘-click, or a tap on a touch
  screen), but opens in the system's browser (or mail app). Only those schemes open: nothing
  from a link can start a program or open a file on the disk. On iOS it goes to Safari, on
  Android to the default browser.
- The editor only. The markdown dialect for printing still prints links literally.

## Written backwards

- `]]target[[` and `(address)[text]` have their brackets drawn red — the brackets only, not the
  words — so the slip shows while typing. Brackets that belong to a real wiki link never count:
  the `]] and [[` between two links stays as it is. `(…)[…]` needs words in both halves, so
  `( )[ ]` stays plain.

## Making one

- Typing `[` straight after a `[` — the second of `[[` — opens the file picker (the Find File
  sheet, titled Link to File), narrowed to the files under the open file's folder and listed by
  their path from there. Typing narrows it as ⇧⌘P does; ↑ ↓ move, ↩ or a click chooses.
- Choosing writes the path after the `[[` and closes it with `]]`, the caret after the link.
  One ⌘Z takes the path and the closing brackets back out.
- Esc, or a click outside the sheet, leaves the `[[` as typed and writes nothing.
- A third `[` opens nothing. Nor does `[[` typed with several carets.

## Following one

- ⌘-click on a link opens the file it names, as a click on its row in the sidebar would. On
  Windows it is Ctrl-click.
- While ⌘ is held with the pointer over the editor, links underline and show a pointer, so it is
  plain which text will follow.
- A link to a file that is not there says so in an alert, naming the folder links are read from.
  Nothing is created.
- **On a touch screen** — iPhone, iPad, an Android phone — a plain tap on a link opens it, since a
  finger has no ⌘. A long-press still selects and a drag still scrolls; to put the caret inside a
  link, tap beside it and move with the keyboard bar's arrows. A trackpad or mouse on an iPad
  follows the Mac's rule, ⌘-click.
- A plain click with a mouse or trackpad places the caret, as on any text.

## Where it lives

- `src/renderer/editor/wiki-links.js` — finding, reading and writing links, external links
  (`webLinksOn`, `webAddress`), the red backwards brackets (`backwardsOn`), the `[[` typing, the ⌘-click and
  the ⌘-held pointer. Tested in `test/wiki-links.test.js`.
- `src/renderer/sheets/find-file.js` — the picker, with `under` and `onChoose`.
- `src/renderer/model.js` — `requestLink`, `chooseLink`, `followLink`, `openAddress`.
- `openExternal` on the bridge: `shell:openExternal` in `src/main/ipc.js`, and
  `src/mobile/bridge.js` for iOS and Android.
