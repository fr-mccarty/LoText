# Spec: plain task boxes

A `[ ]` or `[x]` anywhere on a line is a box, in any file: at its head, in the middle, or at its
end. It needs no arrow and nothing else around it. An enhanced task's `[ ]`
(`specs/enhanced-tasks.md`) is drawn and clicked the same way.

- **A box stands apart** from the words around it. Before it: the start of the line, a space or
  tab, or `(`. After it: the end of the line, a space or tab, or one of `. , ; : ! ? )`.
  `- [ ] buy stamps`, `ring the clerk [ ], then post it [x]` and `(see [ ])` all have boxes.
  `a[x]`, `[x]a`, `const a = []` and the `[x]` inside a `[[x]]` wiki link do not: brackets glued
  to a word or a bracket are plain text. *Departure: the user asked for boxes "wherever it sits in
  the line"; until then only the head of a line counted.*
- A line may hold several boxes; each is drawn and clicked on its own.
- `x` may be lower or upper case; a click writes `x`.
- **Clicking** a box flips the one character between its brackets, `' '` ↔ `x`. The caret does
  not move, and ⌘Z undoes it.
- **Typing** `]` right after a `[` at the head of a line — after its indent (spaces or tabs) and
  an optional list marker, `-`, `*`, `+`, `1.` or `1)`, and a space — gives `[ ]`, the caret after
  it. Elsewhere `[]` stays `[]`, so code is not rewritten as it is typed.
- The characters stay what they are: the box is the text, drawn in the accent colour with a
  pointer so it looks like it takes a click.
- A plain box hides nothing and closes nothing. `[ ] do something` is not an enhanced task. A
  task's choices are these same boxes; what checking a task's `[ ]` also does is in
  `specs/enhanced-tasks.md`.

## Where it lives

- `src/renderer/editor/task-boxes.js` — the box test, the click and the `[]` typing.
- `src/renderer/sheets/help.js` — Help ▸ Enhanced Tasks, “Plain boxes”.
