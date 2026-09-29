// The editor side of enhanced tasks (`specs/enhanced-tasks.md`) and of the disclosure arrows at
// the end of any line (`specs/disclosures.md`): every arrow, a task's `==>` / `==v` and a
// disclosure's `-->` / `--v`, is drawn as a small button and a click flips it, what the arrows
// close is hidden, checking a task collapses it in the same edit, typing into an empty choice
// checks it, and an arrow that is typed is written open.
// One field and one click handler serve both, so a task's arrows and the arrows inside it never
// fight over a click.
//
// What is hidden is read from the text. The one thing the view keeps is which tasks and
// disclosures a caret or an edit has reached into (Find, undo, ⌫ after a fold): those show
// everything until the next click on that arrow or that task's box. It is gone when the file is
// closed.

import { StateField, StateEffect, EditorState, EditorSelection, ChangeSet, MapMode, Text } from '@codemirror/state'
import { EditorView, Decoration } from '@codemirror/view'
import { invertedEffects } from '@codemirror/commands'
import * as Tasks from './enhanced-tasks.js'
import * as Disclosures from './disclosures.js'
import { moveBlocks } from './move-items.js'

/** A click on an arrow, by its owner's line start: it ends a reveal. */
const arrowClicked = StateEffect.define()

/**
 * Marks a ⌥↑ / ⌥↓ move, and the undo and redo of one (`invertedEffects` hands it on): lines
 * changing places, not an edit into a fold, so nothing is revealed or rewritten.
 */
const linesMoved = StateEffect.define()
const isMove = (tr) => tr.effects.some((effect) => effect.is(linesMoved))

/** The user event of an arrow click: the one edit that may write a closed arrow. */
const DISCLOSE = 'input.disclose'

const linesOf = (doc) => doc.toString().split('\n')

/** Hidden lines as document ranges: from the end of the line above to the end of the last. */
const rangesOf = (doc, hidden) => hidden.map(({ first, last }) =>
  ({ from: doc.line(first).to, to: doc.line(last + 1).to }))

/**
 * Tasks and disclosures with document positions: the first line's start is each one's identity.
 * A disclosure's line is never a task's line, so the two never share one.
 */
function locate (doc) {
  const lines = linesOf(doc)
  const parsed = Tasks.parseTasks(lines)
  const at = (line) => doc.line(line + 1).from
  const tasks = parsed.map((task) => ({ ...task, pos: at(task.line), ranges: rangesOf(doc, Tasks.hiddenLines(task)) }))
  const disclosures = Disclosures.parseDisclosures(lines, { skip: Disclosures.reservedLines(lines, parsed) })
    .map((disclosure) => ({ ...disclosure, pos: at(disclosure.line), ranges: rangesOf(doc, Disclosures.hiddenLines(disclosure)) }))
  return { tasks, disclosures }
}

/** The ranges actually hidden, each with its owner: a revealed task or disclosure hides nothing. */
function hiddenRanges ({ tasks, disclosures, revealed }) {
  const out = []
  for (const owner of [...tasks, ...disclosures]) {
    if (revealed.has(owner.pos)) continue
    for (const range of owner.ranges) if (range.to > range.from) out.push({ ...range, pos: owner.pos })
  }
  return out
}

/** The hidden ranges sorted and joined where they touch or nest, for drawing. */
function merged (ranges) {
  const out = []
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    const previous = out[out.length - 1]
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to)
    else out.push({ from: range.from, to: range.to })
  }
  return out
}

const inside = (head, range) => head > range.from && head < range.to

/**
 * What is hidden in `state` right now, as document ranges joined where they nest or touch: each
 * from the end of a collapsed task's or disclosure's line to the end of the last line it hides.
 * Empty in an editor without enhanced tasks.
 */
export function foldedRanges (state) {
  const value = state.field(enhancedField, false)
  return value ? merged(hiddenRanges(value)) : []
}

export const enhancedField = StateField.define({
  create (state) {
    return { ...locate(state.doc), revealed: new Set() }
  },

  update (value, tr) {
    let { tasks, disclosures, revealed } = value
    const clicks = tr.effects.filter((effect) => effect.is(arrowClicked))
    if (tr.docChanged) {
      revealed = new Set(revealed)
      if (isMove(tr)) {
        // Moved lines keep the state their arrows say; a reveal among them is dropped.
        tr.changes.iterChangedRanges((fromA, toA) => {
          for (const pos of revealed) if (pos >= fromA && pos <= toA) revealed.delete(pos)
        })
      } else if (!clicks.length) {
        // A change that reaches into hidden text shows it, so an edit is never made unseen. The
        // newline after the fold counts, so ⌫ at the start of the line below reveals. An arrow
        // click is the one change that means to hide.
        tr.changes.iterChangedRanges((fromA, toA) => {
          for (const range of hiddenRanges(value)) {
            if (fromA < range.to + 1 && toA > range.from) revealed.add(range.pos)
          }
        })
      }
      // A reveal whose owner's line was deleted, start to end, goes with it. Mapped, it would
      // land on the start of whatever slid up into its place and open that instead.
      const deleted = (pos) => {
        const end = tr.startState.doc.lineAt(pos).to
        let gone = false
        tr.changes.iterChangedRanges((fromA, toA) => { if (fromA <= pos && toA >= end && toA > fromA) gone = true })
        return gone
      }
      revealed = new Set([...revealed].filter((pos) => !deleted(pos)).map((pos) => tr.changes.mapPos(pos, 1)))
      const before = new Map(tasks.map((task) => [tr.changes.mapPos(task.pos, 1), task]))
      ;({ tasks, disclosures } = locate(tr.newDoc))
      // Checking a task's box hides it again, as a click on its arrow does.
      for (const task of tasks) {
        const old = before.get(task.pos)
        if (old && !old.checked && task.checked) revealed.delete(task.pos)
      }
    }
    if (clicks.length) {
      revealed = new Set(revealed)
      for (const effect of clicks) revealed.delete(effect.value)
    }
    // Keep only what still names a task or a disclosure.
    const alive = new Set([...tasks, ...disclosures].map((owner) => owner.pos))
    revealed = new Set([...revealed].filter((pos) => alive.has(pos)))

    // A caret put inside hidden text — Find, undo — shows it. Either edge of the fold is
    // outside it: both are drawn at the end of the line above.
    if (tr.selection) {
      const head = tr.state.selection.main.head
      for (const range of hiddenRanges({ tasks, disclosures, revealed })) {
        if (inside(head, range)) revealed.add(range.pos)
      }
    }
    return { tasks, disclosures, revealed }
  },

  provide: (field) => EditorView.decorations.compute([field], (state) => decorationsFor(state, state.field(field))),
})

const titleLine = Decoration.line({ class: 'lo-enhanced-title' })
const arrow = Decoration.mark({ class: 'lo-disclosure' })
const hidden = Decoration.replace({})

function decorationsFor (state, value) {
  const ranges = []
  for (const task of value.tasks) {
    // The arrow is the only sign that something is folded: no ellipsis after it.
    ranges.push(titleLine.range(task.pos))
    ranges.push(arrow.range(task.pos + task.arrowColumn, task.pos + task.arrowColumn + 3))
  }
  for (const disclosure of value.disclosures) {
    ranges.push(arrow.range(disclosure.pos + disclosure.column, disclosure.pos + disclosure.column + 3))
  }
  // Nested folds, a task's and the disclosures' inside it, are drawn as one.
  for (const range of merged(hiddenRanges(value))) ranges.push(hidden.range(range.from, range.to))
  return Decoration.set(ranges, true)
}

/**
 * A click on an arrow — a task's or a disclosure's — flips it and leaves the caret where it was, unless that is inside what the click hides, when it goes to the end of the
 * line the fold is drawn on.
 */
const clicks = EditorView.domEventHandlers({
  mousedown (event, view) {
    if (event.button !== 0 || event.shiftKey || event.metaKey || event.altKey) return false
    const target = event.target instanceof Element ? event.target.closest('.lo-disclosure') : null
    if (!target) return false
    const doc = view.state.doc
    const pos = view.posAtDOM(target)
    const line = doc.lineAt(pos)
    const index = line.number - 1
    const { tasks, disclosures } = view.state.field(enhancedField)
    const task = tasks.find((candidate) => candidate.line === index)
    const disclosure = task ? null : disclosures.find((candidate) => candidate.line === index)
    const owner = task ?? disclosure
    if (!owner) return false
    const edit = task ? Tasks.arrowFlip(task) : Disclosures.arrowFlip(disclosure)
    const at = doc.line(edit.line + 1).from + edit.column
    view.dispatch({
      changes: { from: at, to: at + 1, insert: edit.char },
      effects: arrowClicked.of(owner.pos),
      userEvent: DISCLOSE,
    })
    const head = view.state.selection.main.head
    const range = hiddenRanges(view.state.field(enhancedField)).find((candidate) => inside(head, candidate))
    if (range) view.dispatch({ selection: EditorSelection.cursor(range.from) })
    event.preventDefault()
    return true
  },
})

/** A cursor at the start of the fold `head` would sit inside once `task` hides, or null. */
function caretOutside (doc, task, head) {
  const range = rangesOf(doc, Tasks.hiddenLines(task)).find((candidate) => inside(head, candidate))
  return range ? EditorSelection.cursor(range.from) : null
}

/**
 * Checking a task's box — a click or typing — collapses it in the same edit, so everything under
 * the task line hides and one ⌘Z brings it back. Unchecking changes no arrow.
 * Undo and redo carry their own arrows and are left alone.
 */
const checking = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.isUserEvent('undo') || tr.isUserEvent('redo') || isMove(tr)) return tr
  const unchecked = new Set(tr.startState.field(enhancedField).tasks
    .filter((task) => !task.checked).map((task) => tr.changes.mapPos(task.pos, 1)))
  if (!unchecked.size) return tr
  const doc = tr.newDoc
  const checked = Tasks.parseTasks(linesOf(doc))
    .filter((task) => task.checked && unchecked.has(doc.line(task.line + 1).from))
  if (!checked.length) return tr
  const changes = ChangeSet.of(checked.flatMap(Tasks.checkEdits).map((edit) => {
    const at = doc.line(edit.line + 1).from + edit.column
    return { from: at, to: at + 1, insert: edit.char }
  }), doc.length)
  const after = changes.apply(doc)
  let selection = tr.newSelection.map(changes)
  for (const task of checked) {
    selection = caretOutside(after, { ...task, open: false }, selection.main.head) ?? selection
  }
  return [tr, { changes, selection, sequential: true }]
})

/** Typing into an empty choice under a task (`  [ ] `) checks its box. No new choice is added. */
const emptyChoice = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input')) return tr
  let fromA = Infinity; let toA = -Infinity; let fromB = Infinity; let toB = -Infinity
  tr.changes.iterChangedRanges((a1, a2, b1, b2) => {
    fromA = Math.min(fromA, a1); toA = Math.max(toA, a2); fromB = Math.min(fromB, b1); toB = Math.max(toB, b2)
  })
  const oldLine = tr.startState.doc.lineAt(fromA)
  const newLine = tr.newDoc.lineAt(fromB)
  if (toA > oldLine.to || toB > newLine.to) return tr
  const choice = Tasks.parseChoice(oldLine.text)
  if (!choice || choice.checked || choice.label) return tr
  const edit = Tasks.emptyChoiceEdit(linesOf(tr.newDoc), newLine.number - 1)
  if (!edit) return tr
  const at = newLine.from + edit.column
  const changes = ChangeSet.of([{ from: at, to: at + 1, insert: edit.char }], tr.newDoc.length)
  return [tr, { changes, selection: tr.newSelection.map(changes), sequential: true }]
})

/**
 * An arrow that typing or a paste brings into being — a disclosure's `-->`, a task's `==>` — is
 * written open, `--v` or `==v`, in the same edit, so nothing hides the moment it appears. An
 * arrow already there before the edit keeps its state, as does everything that is not typing:
 * a click on an arrow, undo and redo, a file read from disk.
 */
const typedArrows = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input') || tr.isUserEvent(DISCLOSE)) return tr
  const before = tr.startState.doc
  const doc = tr.newDoc
  // The arrows on the lines the edit touched, before it (mapped to where they are now) and after.
  const existed = new Set()
  const touched = []
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    for (let pos = fromA; pos <= toA;) {
      const line = before.lineAt(pos)
      for (const { column } of Disclosures.arrowsOnLine(line.text)) {
        // Still the same arrow when its first two characters survived the edit.
        const start = tr.changes.mapPos(line.from + column, 1, MapMode.TrackAfter)
        const end = tr.changes.mapPos(line.from + column + 2, -1, MapMode.TrackBefore)
        if (start !== null && end === start + 2) existed.add(start)
      }
      pos = line.to + 1
    }
    for (let pos = fromB; pos <= toB;) {
      const line = doc.lineAt(pos)
      touched.push(line.number - 1)
      pos = line.to + 1
    }
  })
  const lines = new Set(touched)
  const typed = (arrow) => lines.has(arrow.line) && !arrow.open && !existed.has(doc.line(arrow.line + 1).from + arrow.column)
  if (![...lines].some((line) => Disclosures.arrowsOnLine(doc.line(line + 1).text).some((arrow) => typed({ ...arrow, line })))) return tr
  const arrows = Disclosures.liveArrows(linesOf(doc)).filter((arrow) => lines.has(arrow.line))
  const edits = Disclosures.openingEdits(arrows, (arrow) => !typed(arrow))
  if (!edits.length) return tr
  const changes = ChangeSet.of(edits.map((edit) => {
    const at = doc.line(edit.line + 1).from + edit.column
    return { from: at, to: at + 1, insert: edit.char }
  }), doc.length)
  return [tr, { changes, selection: tr.newSelection.map(changes, 1), sequential: true }]
})

// MARK: - ⌥↑ and ⌥↓, moving items

/**
 * Moves the lines the selection covers one line up (`direction` -1) or down (+1), a task or a
 * closed disclosure whole and past a whole neighbouring item (`move-items.js`). One edit, so one
 * ⌘Z undoes it; the selection keeps its place in the moved text. False when nothing can move.
 */
export function moveItems (view, direction) {
  const { state } = view
  const doc = state.doc
  const lines = linesOf(doc)
  const ranges = state.selection.ranges.map((range) => {
    // A selection ending at the very start of a line does not take that line with it.
    const end = range.to > range.from && doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to
    return { first: doc.lineAt(range.from).number - 1, last: doc.lineAt(end).number - 1 }
  })
  const moved = moveBlocks(lines, ranges, direction)
  if (!moved) return false

  // Only the runs of lines that changed places are rewritten.
  const changes = []
  for (let index = 0; index < lines.length; index++) {
    if (lines[index] === moved.lines[index]) continue
    let last = index
    while (last + 1 < lines.length && lines[last + 1] !== moved.lines[last + 1]) last++
    changes.push({ from: doc.line(index + 1).from, to: doc.line(last + 1).to, insert: moved.lines.slice(index, last + 1).join('\n') })
    index = last
  }
  const after = Text.of(moved.lines)
  const shifted = (pos, shift) => {
    const line = doc.lineAt(pos)
    const target = line.number + shift
    return target > after.lines ? after.length : after.line(target).from + pos - line.from
  }
  const selection = EditorSelection.create(state.selection.ranges.map((range, index) =>
    EditorSelection.range(shifted(range.anchor, moved.shifts[index]), shifted(range.head, moved.shifts[index]))),
  state.selection.mainIndex)
  view.dispatch({ changes, selection, effects: linesMoved.of(null), scrollIntoView: true, userEvent: 'move.line' })
  return true
}

const moveHistory = invertedEffects.of((tr) => isMove(tr) ? [linesMoved.of(null)] : [])

export const enhancedTasks = [enhancedField, clicks, checking, emptyChoice, typedArrows, moveHistory]
