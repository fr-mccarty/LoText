# Spec: disclosure arrows

What a disclosure arrow is — the single arrow, `-->` collapsed and `--v` expanded, hiding the
lines indented under it — is the toolbox's disclosure-arrow spec,
`/Volumes/jam-dev-tools/specs/disclosure-arrow/README.md`. The double arrow, `==>`, is an enhanced
task's (`specs/enhanced-tasks.md`). There is nothing like either in Lolext. This file holds only
how LoText reads, draws and edits the single arrow.

The user-facing name is *disclosure arrow*, in the Help and everywhere else; the code calls a line
that ends in one a disclosure.

## Reading the text

```
submission_to_tribunal_date* --v
  Type: date
  Width in Sixths: 3 --v
    More Detail Here: ;lkjlkajsfdf
next line
```

- **Where the arrow sits.** LoText reads the arrow only at the end of a line: ` -->` or ` --v`
  after whitespace, or alone after the indent, trailing spaces allowed. An arrow in the middle
  of a line (`a --> b`) or with no space before it (`text-->`) is plain text, so prose and code
  that happen to contain `-->` are left alone.
- **HTML comments.** A line with `<!--` before its arrow, such as `<!-- note -->`, is plain text,
  and so is a `-->` alone in the first column, the end of a longer comment.
- **Enhanced-task lines** are never disclosures, whatever they end in, and end any body they
  would fall into. Every other line a task owns may carry an arrow of its own.
- **The body** is every line straight under the arrow's line indented deeper than it, by any
  amount, in leading spaces; the Tab setting plays no part. A body line ending in an arrow owns
  the lines deeper than its own indent under it, and so on down. In the example, `Type: date`,
  `Width in Sixths` and `More Detail Here` belong to the first line, `More Detail Here` also
  belongs to `Width in Sixths`, and `next line` ends both.
- The body ends at the first line indented no deeper than the arrow's line, or at two blank lines
  (empty or only spaces) in a row. A single blank line belongs to the body when a deeper line
  follows it, and hides with it. Tabs are not spaces: a line indented with a tab is at indent 0.
- A line with an arrow and no body still has one; clicking it only changes the text.
- The arrow is text: `-->` and `--v` are exactly what is saved. The editor draws it as a small
  button. Every character on disk is a character in the buffer.

## Clicking

- **An arrow** flips `-->` ↔ `--v` (its third character). The caret does not move, unless it is
  in what the click hides, when it goes to the end of the arrow's line. ⌘Z undoes it.
- Collapsing an arrow hides its whole body, nested arrows and all. Expanding it shows the body,
  and the nested arrows then follow their own state.
- A click on text places the caret, so the line and its body stay editable.

## Typing

An arrow that typing or a paste brings into being is written expanded: typing ` -->` at the end
of a line gives ` --v`, and nothing hides. Only an arrow that was not there before the edit is
rewritten, in the same edit, and the caret stays after it. Arrows already in a file when it is
opened, or that arrive from disk (⌘R, a change made elsewhere), keep the state they were saved
with, and so does anything undo or redo puts back. A click is the way to collapse an arrow.

## Hiding

A collapsed arrow hides from the end of its line to the end of the last line of its body, drawn
as an enhanced task's folds are: the arrow is the only sign that something is folded — nothing is
drawn after it — and the arrow keys skip the hidden lines. A caret that Find or undo drops into
hidden lines shows them, and so does an edit that reaches into them; the arrow is not rewritten.
That lasts until the next click on that arrow.

## Hide Lines and Show Lines

Edit ▸ Hide Lines (⌘[) and Edit ▸ Show Lines (⌘]), after VS Code's Fold, Fold Selection and
Unfold. They work the arrows from the keyboard, and hide lines that have no arrow over them.

- **Hide Lines with a caret** closes the innermost arrow around it whose body is showing — a task's
  or a disclosure's, open, or closed but shown by Find or an edit — the same edit as a click, so
  one ⌘Z opens it again. Pressed again, it closes the next arrow out. Outside every arrow it does
  nothing.
- **Hide Lines with a selection over several lines** keeps the first line and hides the rest. When
  the first line has an arrow, it closes that arrow instead. Otherwise the lines are hidden on
  screen only: nothing is written to the file, and ⋯ is drawn after the first line. A selection
  over one line is treated as a caret. A selection ending at the very start of a line leaves that
  line out.
- **Show Lines** on a line with ⋯ after it shows the lines hidden there; on a closed arrow's line it
  opens the arrow, the same edit as a click. A click on ⋯ shows its lines too.
- What Hide Lines hid with ⋯ shows again the way a fold does: a caret that Find or undo drops into
  it, an edit that reaches into it (the newline after it included), and ⌥↑ / ⌥↓ moving its lines
  or the line above them. Typing on the line above keeps it hidden. It is not saved, and closing
  the file forgets it.
- Whatever hides, a selection reaching into it goes to the end of the line above it.

## Moving

Edit ▸ Move Line Up / Down (⌥↑ / ⌥↓):

- **A collapsed arrow's line** moves with its whole body, nested arrows and all, and steps over
  a whole neighbour in one press: the largest task or disclosure, collapsed or expanded, that
  holds the next line and ends there — or, when there is none, just that line. So it never lands
  inside another item, though it can leave the section it is in.
- **An expanded arrow's line**, and any other line, moves one line at a time, so a line can be
  moved into and out of an expanded section. A collapsed item counts as one line: its head and
  the lines it hides are stepped over together. So a line never lands among hidden lines.
- The moved lines are the ones the selection covers, touching selections together, grown until
  every collapsed arrow's line and task line among them has its whole body. A task moves as in
  `specs/enhanced-tasks.md`.
- Lines keep their text exactly — nothing is reindented, so a moved body may belong elsewhere
  afterwards — and every arrow keeps its state. The caret keeps its place in the moved text, one
  ⌘Z undoes the move, and at the top or bottom of the file nothing happens.

## Cutting

⌘X with nothing selected cuts the caret's line. On a **collapsed** arrow's line it cuts the whole
item: the line and its body, nested arrows and all, so nothing is left behind unseen. An expanded
arrow's line is cut alone, as any line. One ⌘Z puts it back. What counts is what is hidden on
screen, so an item Find or undo has opened is cut as an open one, and the line above ⋯ is cut with
the lines Hide Lines hid under it.

## Printing

Printing and PDF show the text as written, arrows and all. The markdown dialect is kept small on
purpose, so this is an editor feature only.

## Where it lives

- `src/renderer/editor/disclosures.js` — the arrow, which lines are reserved, bodies, what is
  hidden, the click edit, and which arrows an edit has just typed. Pure functions, tested in
  `test/disclosures.test.js`.
- `src/renderer/editor/enhanced-view.js` — the CodeMirror side, shared with enhanced tasks: one
  field, one click handler, the hiding and the typing filters, Hide Lines and Show Lines. Tested
  in `test/hide-lines.test.js`.
- `src/renderer/editor/move-items.js` — what ⌥↑ / ⌥↓ move and what they step over. Pure
  functions, tested in `test/move-items.test.js`.
- `src/renderer/sheets/help.js` — Help ▸ Disclosure Arrows, the user-facing version of this spec.
  Change it when the behaviour changes.
