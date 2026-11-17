// Task boxes: a `[ ]` / `[x]` anywhere on a line — at its head, in the middle or at the end —
// can be clicked, and a click flips the one character between the brackets. An enhanced task's
// `[ ]` is a box like any other. Typing `[]` at the head of a line lands as `[ ]`.
//
// The characters stay what they are: the box is the text, marked so it takes a click and looks
// like it will. A box stands apart from the words around it — a space, the line's edge, or
// punctuation on either side — so `a[x]` in code and the `[x]` inside a `[[x]]` link are left
// alone.

import { Decoration, EditorView, ViewPlugin, MatchDecorator } from '@codemirror/view'

/** What may stand before a box typed at the head of a line: indent, then `-`, `*`, `+`, `1.` or `1)`. */
const LEAD = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?$/

/** A box: not glued to a word or a bracket on either side. */
const BOX = /(?<=^|[\s(])\[([ xX])\](?=$|[\s.,;:!?)])/g

/**
 * Every box on a line, left to right: where it starts, where its mark (the character between
 * the brackets) is, and whether it is checked.
 */
export function boxesOn (text) {
  return [...text.matchAll(BOX)].map((match) =>
    ({ offset: match.index, markColumn: match.index + 1, checked: match[1] !== ' ' }))
}

/** The first box on a line, or null. */
export function boxOn (text) {
  return boxesOn(text)[0] ?? null
}

/** Where the first box on `line` starts, or -1 if the line has none. */
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
  regexp: BOX,
  decorate: (add, from, to) => add(from, to, boxMark),
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
    const pos = view.posAtDOM(target)
    const line = doc.lineAt(pos)
    // The box the click landed in, of however many the line has.
    const box = boxesOn(line.text).find((candidate) =>
      line.from + candidate.offset <= pos && pos < line.from + candidate.offset + 3)
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
