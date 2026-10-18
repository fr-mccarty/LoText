# Spec: enhanced tasks

What an enhanced task is — the `[[ ]] ==> (()) title` line, what collapsing hides, checking,
feedback — is jam-spec's enhanced-task spec, [`jam-spec/enhanced-task/README.md`](https://github.com/fr-mccarty/jam-spec/blob/main/enhanced-task/README.md).
The choices under a task are its enhanced-selection spec,
[`jam-spec/enhanced-selection/README.md`](https://github.com/fr-mccarty/jam-spec/blob/main/enhanced-selection/README.md). There is nothing like either in
Lolext. This file holds only how LoText reads, draws and edits them.

## Reading the text

- A task line is exactly `[[`, a mark, `]] `, the arrow, a space, `((`, the feedback, `))`, and
  then optionally a space and the title, starting in column 0. The mark is a space, `x` or `X`;
  the app writes `x`. Other spacing is plain text, not a task line.
- **What a task owns** is the lines indented deeper straight under it, by the same rule as a
  disclosure arrow's body (`specs/disclosures.md`): the first line back at column 0 ends it, and so
  do two blank lines in a row; one blank line with an indented line after it belongs to it.
- A choice is a line of two spaces, `[ ]` or `[x]`, and optionally a space and its label, among
  the lines a task owns.
- The arrows are text: `==>` and `==v` are exactly what is saved. The editor draws the task arrow
  as a small button and the title in bold. Every character on disk is a character in the buffer.
- A line a task owns may have a disclosure arrow of its own, `-->` or `==>`
  (`specs/disclosures.md`). The task line itself never is one: its own `==>` is the task's, and
  any other arrow in its title is plain text. A `==>` on any line that is not a task line is a
  disclosure arrow.
- A long line under a task wraps as any indented line does (the hanging indent in `CLAUDE.md`).

## Clicking

- **The arrow** flips `==>` ↔ `==v` (its third character). The caret does not move unless it is
  in what the click hides, when it goes to the end of the task line. ⌘Z undoes it. A `==>` whose
  lines Find or an edit has shown (Hiding) is not flipped: the click hides them again.
- **The task's box**, `[[ ]]`, flips its mark. Checking it also writes `==>` in the same edit, so
  one ⌘Z brings both back. Unchecking changes no arrow. Nested disclosure arrows keep their state.
- **A choice's box** flips, as any box does (`specs/task-boxes.md`).

## Typing

- Typing `x` into the task's box checks it and collapses it, as a click would.
- Typing into an empty choice (`  [ ] `) so that it gains text checks its box. This happens only
  on a line a task owns. No new empty choice is added.
- An arrow that typing or a paste brings into being is written expanded: `==>` becomes `==v` in the
  same edit, the caret after it, so nothing hides the moment it appears. Arrows already in the
  file, or arriving from disk, keep their state; a click collapses one.

## Hiding

The arrow is the only sign that something is hidden; nothing, no ellipsis, is drawn after it.
Hidden lines are skipped by the arrow keys. A caret that Find or undo drops into hidden lines, or
an edit that reaches into them, shows them; the arrow is not rewritten. That is the only state the
view keeps, and it lasts until the next click on that task's arrow, which hides them again, or its
box being checked. A caret the app puts back itself — reopening a file where it was left, a reload
from disk keeping its place — shows nothing: it goes to the end of the task line instead, so a
`==>` never sits over lines that show without Find or an edit having shown them.

## Moving

Edit ▸ Move Line Up / Down (⌥↑ / ⌥↓) moves a task whole — its line and every line it owns,
collapsed or expanded — whenever the lines the selection covers include the task line. A
visible line of the task on its own moves as any line does. Any other line steps over a collapsed
task whole and into an expanded one a line at a time. A whole task steps over a whole neighbour
in one press: the largest task or disclosure that holds the next line and ends there
(`specs/disclosures.md`, Moving), or just that line. The text of every line is kept exactly, the
arrows keep their state, the caret keeps its place, and one ⌘Z undoes the move. At the top or
bottom of the file nothing happens.

## Cutting

⌘X with nothing selected cuts the caret's line (`cutWholeLines` in `line-editing.js`).
On a **collapsed** task's line it cuts the whole task: the line and every indented line it hides,
nested disclosures and all. An expanded task's line is cut alone, as any line.
What goes to the clipboard is exactly what left the text, and one ⌘Z puts it back.

## Printing

Printing and PDF show the text as written, arrows and all. The markdown dialect is kept small on
purpose, so enhanced tasks are an editor feature only.

## Where it lives

- `src/renderer/editor/enhanced-tasks.js` — parsing, what is hidden, the arrow and choice edits.
  Pure functions, tested in `test/enhanced-tasks.test.js`. What a task owns comes from `bodyUnder`
  in `indented-body.js`, shared with disclosures and Hide Lines.
- `src/renderer/editor/enhanced-view.js` — the CodeMirror side: the arrows, hiding, clicks and
  the typing filters, shared with `specs/disclosures.md`. Tested in `test/typed-task.test.js`.
- `src/renderer/editor/task-boxes.js` — the `[[ ]]` box is drawn and clicked as a plain box is.
- `src/renderer/editor/move-items.js` — what ⌥↑ / ⌥↓ move and what they step over. Tested in
  `test/move-items.test.js`.
- `src/renderer/sheets/help.js` — Help ▸ Enhanced Tasks, the user-facing version of this spec.
  Change it when the behaviour changes.
