// Task boxes: `[ ]` / `[x]` at the head of a line — after its indent and an optional list
// marker — can be clicked, and a click flips the one character between the brackets. An enhanced
// task's `[[ ]]` / `[[x]]` is a box the same way. Typing `[]` in that same place lands as `[ ]`.
//
// The characters stay what they are: the box is the text, marked so it takes a click and looks
// like it will. Only the head of a line counts, so `a[x]` in code and `[]` in `const a = []`
// are left alone.

import { Decoration, EditorView, ViewPlugin, MatchDecorator } from '@codemirror/view'

/** What may stand before a box on its line: indent, then `-`, `*`, `+`, `1.` or `1)`. */
const LEAD = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?$/

const BOX_AT_HEAD = /^([ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?)(\[\[([ xX])\]\]|\[([ xX])\])/

/**
 * Where the box on a line starts, where its mark (the character between the brackets) is, and
 * whether it is checked; or null.
 */
export function boxOn (text) {
  const match = BOX_AT_HEAD.exec(text)
  if (!match) return null
  const mark = match[3] ?? match[4]
  const offset = match[1].length
  return { offset, markColumn: offset + (match[3] ? 2 : 1), checked: mark !== ' ' }
}

/** Where the box on `line` starts, or -1 if the line has none. */
export function boxOffset (line) {
  return boxOn(line)?.offset ?? -1
}

/** The character that goes between the brackets after a click. */
export function flipped (mark) {
  return mark === ' ' ? 'x' : ' '
}

/** Whether `]` typed after `before` (the line up to the caret) closes a box. */
export function closesBox (before) {
  return before.endsWith('[') && LEAD.test(before.slice(0, -1))
}

const boxMark = Decoration.mark({ class: 'lo-task-box' })

const matcher = new MatchDecorator({
  regexp: /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?(\[\[[ xX]\]\]|\[[ xX]\])/gm,
  decorate: (add, from, to, match) => {
    const start = to - match[1].length
    add(start, to, boxMark)
  },
})

const marks = ViewPlugin.fromClass(class {
  constructor (view) {
    this.decorations = matcher.createDeco(view)
  }

  update (update) {
    this.decorations = matcher.updateDeco(update, this.decorations)
  }
}, { decorations: (plugin) => plugin.decorations })

/** A click on a box flips it and leaves the caret where it was. */
const clicks = EditorView.domEventHandlers({
  mousedown (event, view) {
    if (event.button !== 0 || event.shiftKey || event.metaKey || event.altKey) return false
    const target = event.target instanceof Element ? event.target.closest('.lo-task-box') : null
    if (!target) return false
    const doc = view.state.doc
    const line = doc.lineAt(view.posAtDOM(target))
    const box = boxOn(line.text)
    if (!box) return false
    const at = line.from + box.markColumn
    view.dispatch({
      changes: { from: at, to: at + 1, insert: flipped(line.text[at - line.from]) },
      userEvent: 'input',
    })
    event.preventDefault()
    return true
  },
})

const typing = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ']' || from !== to) return false
  const line = view.state.doc.lineAt(from)
  if (!closesBox(line.text.slice(0, from - line.from))) return false
  view.dispatch({
    changes: { from, insert: ` ${text}` },
    selection: { anchor: from + 2 },
    userEvent: 'input.type',
  })
  return true
})

export const taskBoxes = [marks, clicks, typing]
