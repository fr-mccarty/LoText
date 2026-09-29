# Editor and window pitfalls

*2026-09-22*

Bugs that were found and fixed, kept for the reason each happened, since each is a trap that
can be walked into again by code that looks correct.

## CodeMirror's base theme beats the stylesheet

CodeMirror injects its base theme as a stylesheet of its own, and an ordinary rule in
`src/renderer/style.css` loses to it. Two symptoms:

- The caret was CodeMirror's 1.2px **black** bar, invisible on a dark window, although a rule
  meant to colour it was already there. Fixed with `!important` on `.cm-cursor`.
- `.cm-activeLine { background: transparent }` never did anything. The active-line highlight is
  gone because `highlightActiveLine()` is no longer an extension — remove the extension rather
  than fight its styling.

## System colours need `color-scheme: light dark`

Without it, `Canvas`, `Field` and `Highlight` resolve to their **light** values in every
appearance. That is what painted the detail pane white under the dark scheme's near-white text.

## A hidden grid item leaves the grid

The window is a three-track grid: sidebar, splitter, pane. Hiding the sidebar with
`display: none` on it and the splitter **and** `grid-template-columns: 0 0 1fr` left the pane as
the only child, and it auto-placed into the *first* track — the zero-width one. ⇧⌘B showed an
empty window. The hidden layout is one column: `grid-template-columns: 1fr`.

## ⌥-arrows reach the page before the menu

A ⌘ shortcut goes to the menu first. ⌥↑ and ⌥↓ do not: the web page gets them first, and the
text view's own ⌥↑ (to the start of the paragraph) consumed them, so Move Line Up as a menu
accelerator never fired. The editor's own `Alt-ArrowUp`/`Alt-ArrowDown` binding does the work
now; the menu still shows the keys with `registerAccelerator: false`, so nothing runs twice.

Any other shortcut without ⌘ would have the same problem. `CLAIMED_BY_MENU` in
`src/renderer/editor/editor.js` is the list of keys CodeMirror must *not* bind; a key belongs on
it only if the menu can actually receive it.

Testing it: `webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up', modifiers: ['alt'] })`
goes through the page, so it proves the editor handles the key — not that the native menu would.

## Sidebar moves do not use HTML5 drag and drop

Rows were `draggable` with `dragstart`/`dragover`/`drop` handlers that looked right, and
dragging a file onto a folder did nothing in the real app. The native drag session also cannot
be scripted: `sendInputEvent` mouse events, even with `leftButtonDown`, never fire `dragstart`,
so the failure could not be pinned down from here. Moves are now plain mouse events
(`beginPress` in `src/renderer/sidebar/sidebar.js`): a press becomes a drag after 4px, a ghost
follows the pointer, the drop target is `elementFromPoint(...).closest('[data-drop-path]')`, Esc
cancels, and the click that follows the mouse-up is swallowed. That path *is* scriptable — drive
it with `mouseDown`, `mouseMove` with `modifiers: ['leftButtonDown']`, and `mouseUp`.

Dropping files in **from Finder** would need HTML5 drop again (for `dataTransfer.files`) and is
not implemented.

## Redrawing a panel resets its scroll

The Settings panel redraws a whole tab on every change, and emptying the panel clamps its
`scrollTop` to 0. Changing a margin halfway down Printing threw the panel to the top — twice,
once for the IPC answer and once for the `settings:changed` broadcast. `render()` in
`src/renderer/settings/settings.js` now saves the position before and restores it after, per tab.

## `lastIndexOf('\n', -1)` is not "not found"

A negative `fromIndex` is read as 0, so on the first line of a file that *starts* with a blank
line, `lastIndexOf('\n', at - 1)` found that newline and put line one after it. That broke
`lineRange` in `src/renderer/editor/text-ranges.js`, and ⌘X on that line with it.

## Word characters and whitespace are Foundation's, not JavaScript's

To match Lolext, a word character includes combining marks (`[\p{L}\p{M}\p{N}_]`), or ⌘B on a
decomposed `café` leaves the accent outside the markers. Trimming uses `WHITESPACE` in
`text-ranges.js`, Foundation's `whitespacesAndNewlines`: JavaScript's `\s` also takes U+FEFF and
misses U+0085 and U+200B. Lolext's treatment of U+2028, U+0085 and a lone `\r` as line ends is
*not* copied — CodeMirror normalises those itself.

## How the editor logic was checked against Lolext

Lolext's `EmphasisMarkers.swift` and `TextRanges.swift` are pure, so they compile on their own
into a small command-line harness. Both implementations were fed the same ~140,000 random
inputs (text, several carets and selections) and the outputs compared; that is how the three
divergences above were found. The agreed behaviour is pinned in
`test/emphasis-markers.test.js` and `test/text-ranges.test.js`. Worth repeating for any other
pure module ported from Lolext.

## Store listings have no `name`

Both file stores return `{path, kind, isLink, leavesTheFolder}`, while the sidebar draws
`node.name` — rows showed icons with no names. The name is attached once, as a listing lands in
the tree (`src/renderer/tree.js`).

## "No window is ready" is not "no window exists"

`deliver()` in `src/main/open-queue.js` confused the two, so a file arriving from the Finder
before the restored windows had finished loading asked for an extra empty window of its own.

## A command line must return its status

`main.js` discarded `runCommandLine`'s return value and let a thrown error escape as an
unhandled rejection, so every CLI failure — unknown preset, unknown paper, missing input —
exited **0** and a script could not tell. It now calls `app.exit(status)` and exits 1 with the
message on stderr, as Lolext's `CommandLineExport.run` does. `app.exit` does not truncate a PDF
written to stdout: the piped output was checked byte for byte.

## ⌘⌫ in the editor trashed the open file

⌘⌫ is one menu accelerator that routes: delete-to-line-start in text, delete the row in the
sidebar. It used to route on `model.isEditingText`, a flag refreshed only on `focusin`/`focusout`.
When the flag was stale (the caret was in the editor but no focus event had updated it), the press
fell through to `deleteSelected({ confirming: false })` — and the selected row was the open file,
so it went to the Trash, unasked. `deleteImmediately()` now reads `document.activeElement` at the
moment of the press and deletes a file only when `.sidebar-list` itself has focus. The flag is still
used for the menu item's *title*, never for the action.

## `contextBridge` drops an error's `code`

*2026-09-26.* An `Error` thrown (or rejected) by a preload function exposed with
`contextBridge.exposeInMainWorld` reaches the page with its `message` and nothing else — `code`
and `current` were silently gone. Every `error.code` branch in the model (`conflict`,
`notFound`, `folderUnavailable` on save, `noTrash` on delete) was dead on the Mac and fell to
the generic "could not…" alert; iOS was fine, its bridge being in the page. Unit tests could
not see it, since they never cross the bridge — it took driving the built app to find.

Fix: `preload.js` rejects with a **plain object**, which is copied whole, and
`src/renderer/bridge-errors.js` makes it an `Error` again. That wrapper copies the bridge rather
than Proxy it: the exposed object is frozen, and a Proxy `get` on a frozen property must return
the property itself, so a Proxy throws on first use.
