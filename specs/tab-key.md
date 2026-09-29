# Spec: the Tab key

*2026-09-24. Asked for by the user; there is nothing like it in Lolext.*

- Tab in the editor inserts spaces and keeps the keyboard in the editor. Before this, Tab moved
  focus to the sidebar.
- Settings ▸ Editor ▸ **Tab inserts**: *2 spaces* or *4 spaces*. The default is 2.
- With a selection across several lines, Tab indents each line by that many spaces and ⇧Tab
  outdents them.
- Esc then Tab still leaves the editor. That is CodeMirror's escape hatch for keyboard users.

The same setting is how far a wrapped enhanced-task description or reference line is indented
(`specs/enhanced-tasks.md`). It does not decide what a disclosure
arrow hides: that is every deeper line, whatever the setting (`specs/disclosures.md`).

## Where it lives

- `src/renderer/editor/editor.js` — the Tab / ⇧Tab binding, `indentBy` and `outdentBy`, and
  `tabSpaces`, read from the settings.
- `src/renderer/settings/settings.js` — the Tab inserts control. `src/shared/settings-shape.js`
  keeps the value at 2 or 4.
