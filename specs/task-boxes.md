# Spec: plain task boxes

A `[ ]` or `[x]` at the head of a line is a box, in any file. It needs no arrow and nothing else
around it. An enhanced task's `[[ ]]` (`specs/enhanced-tasks.md`) is drawn and clicked the same
way, its mark two characters in.

- **The head of a line** is after its indent (spaces or tabs) and an optional list marker —
  `-`, `*`, `+`, `1.` or `1)` — and a space. `- [ ] buy stamps`, `  [x] done` and
  `1) [ ] ring` all have one. `a[x]`, `const a = []` and `text [ ]` do not: brackets anywhere else
  are plain text.
- `x` may be lower or upper case; a click writes `x`.
- **Clicking** the box flips the one character between the brackets, `' '` ↔ `x`. The caret does
  not move, and ⌘Z undoes it.
- **Typing** `]` right after a `[` at the head of a line gives `[ ]`, the caret after it.
- The characters stay what they are: the box is the text, drawn in the accent colour with a
  pointer so it looks like it takes a click.
- A plain box hides nothing and closes nothing. `[ ] do something` is not an enhanced task. A task's choices are these same boxes; what checking
  a task's `[[ ]]` also does is in `specs/enhanced-tasks.md`.

## Where it lives

- `src/renderer/editor/task-boxes.js` — the box test, the click and the `[]` typing.
- `src/renderer/sheets/help.js` — Help ▸ Enhanced Tasks, “Plain boxes”.
