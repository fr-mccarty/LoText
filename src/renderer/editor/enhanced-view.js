// The editor side of enhanced tasks (`specs/enhanced-tasks.md`) and of the disclosure arrows at
// the end of any line (`specs/disclosures.md`): every arrow, a task's `==>` / `==v` and a
// disclosure's `-->` / `--v`, is drawn as a small button and a click flips it, what the arrows
// close is hidden, checking a task collapses it in the same edit, typing into an empty choice
// checks it, and an arrow that is typed is written open.
// One field and one click handler serve both, so a task's arrows and the arrows inside it never
// fight over a click.
//
// What an arrow hides is read from the text. The view keeps two things of its own, both gone when
// the file is closed: which tasks and disclosures a caret or an edit has reached into (Find,
// undo, ⌫ after a fold), which show everything until the next click on that arrow or that task's
// box; and the lines Hide Lines hid with no arrow to close, drawn with a ⋯ button that shows them.

import { StateField, StateEffect, EditorState, EditorSelection, ChangeSet, MapMode, Text } from '@codemirror/state'
import { EditorView, Decoration, WidgetType } from '@codemirror/view'
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

/** Hide Lines with no arrow to close: { from, to }, the lines to hide as a document range. */
const selectionHidden = StateEffect.define()

/** Show Lines or a click on ⋯: the start of the hidden selection to show. */
const selectionShown = StateEffect.define()

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
  return value ? merged([...hiddenRanges(value), ...value.hiddenSelections]) : []
}

/** Whether `fromA`–`toA` reaches into `range`, the newline after it included, as ⌫ below it does. */
const reachesInto = (fromA, toA, range) => fromA < range.to + 1 && toA > range.from

export const enhancedField = StateField.define({
  create (state) {
    return { ...locate(state.doc), revealed: new Set(), hiddenSelections: [] }
  },

  update (value, tr) {
    let { tasks, disclosures, revealed, hiddenSelections } = value
    const clicks = tr.effects.filter((effect) => effect.is(arrowClicked))
    if (tr.docChanged) {
      revealed = new Set(revealed)
      if (isMove(tr)) {
        // Moved lines keep the state their arrows say; a reveal among them is dropped, and so is
        // a hidden selection whose lines or line above moved, so a line never lands among them.
        const startDoc = tr.startState.doc
        tr.changes.iterChangedRanges((fromA, toA) => {
          for (const pos of revealed) if (pos >= fromA && pos <= toA) revealed.delete(pos)
          hiddenSelections = hiddenSelections.filter((range) =>
            !reachesInto(fromA, toA, { from: startDoc.lineAt(range.from).from, to: range.to }))
        })
      } else if (!clicks.length) {
        // A change that reaches into hidden text shows it, so an edit is never made unseen. The
        // newline after the fold counts, so ⌫ at the start of the line below reveals. An arrow
        // click is the one change that means to hide.
        tr.changes.iterChangedRanges((fromA, toA) => {
          for (const range of hiddenRanges(value)) {
            if (reachesInto(fromA, toA, range)) revealed.add(range.pos)
          }
          hiddenSelections = hiddenSelections.filter((range) => !reachesInto(fromA, toA, range))
        })
      }
      // Text typed at the end of the line above goes before the hidden lines, not into them.
      hiddenSelections = hiddenSelections
        .map((range) => ({ from: tr.changes.mapPos(range.from, 1), to: tr.changes.mapPos(range.to, -1) }))
        .filter((range) => range.to > range.from)
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
    for (const effect of tr.effects) {
      if (effect.is(selectionHidden)) hiddenSelections = [...hiddenSelections, effect.value]
      if (effect.is(selectionShown)) hiddenSelections = hiddenSelections.filter((range) => range.from !== effect.value)
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
      hiddenSelections = hiddenSelections.filter((range) => !inside(head, range))
    }
    return { tasks, disclosures, revealed, hiddenSelections }
  },

  provide: (field) => EditorView.decorations.compute([field], (state) => decorationsFor(state, state.field(field))),
})

const titleLine = Decoration.line({ class: 'lo-enhanced-title' })
const arrow = Decoration.mark({ class: 'lo-disclosure' })
const hidden = Decoration.replace({})

/** The sign that lines are hidden with no arrow over them; a click on it shows them. */
class HiddenLinesButton extends WidgetType {
  eq () { return true }

  toDOM () {
    const node = document.createElement('span')
    node.className = 'lo-hidden-lines'
    node.textContent = '⋯'
    node.title = 'Show Lines'
    return node
  }

  ignoreEvent () { return false }
}

const hiddenWithButton = Decoration.replace({ widget: new HiddenLinesButton() })

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
  const buttonsAt = new Set(value.hiddenSelections.map((range) => range.from))
  for (const range of merged([...hiddenRanges(value), ...value.hiddenSelections])) {
    ranges.push((buttonsAt.has(range.from) ? hiddenWithButton : hidden).range(range.from, range.to))
  }
  return Decoration.set(ranges, true)
}

/** The task or disclosure whose arrow is on line `index`, or null. */
function ownerOnLine ({ tasks, disclosures }, index) {
  return tasks.find((task) => task.line === index) ?? disclosures.find((disclosure) => disclosure.line === index) ?? null
}

/** The edit and effect of a click on `owner`'s arrow: it flips, and a reveal of it ends. */
function arrowClick (doc, owner) {
  const edit = 'arrowColumn' in owner ? Tasks.arrowFlip(owner) : Disclosures.arrowFlip(owner)
  const at = doc.line(edit.line + 1).from + edit.column
  return { changes: { from: at, to: at + 1, insert: edit.char }, effects: arrowClicked.of(owner.pos) }
}

/**
 * After something has been hidden, moves each selection that now reaches into hidden lines to
 * the end of the line they are drawn on, so the caret never sits unseen.
 */
function moveSelectionOutOfHidden (view) {
  const folded = foldedRanges(view.state)
  const selection = view.state.selection
  let moved = false
  const ranges = selection.ranges.map((range) => {
    const fold = folded.find((candidate) => range.empty
      ? inside(range.head, candidate)
      : range.from < candidate.to && range.to > candidate.from)
    if (!fold) return range
    moved = true
    return EditorSelection.cursor(fold.from)
  })
  if (moved) view.dispatch({ selection: EditorSelection.create(ranges, selection.mainIndex) })
}

/**
 * A click on an arrow — a task's or a disclosure's — flips it and leaves the caret where it was,
 * unless that is inside what the click hides, when it goes to the end of the line the fold is
 * drawn on. A click on ⋯ shows the lines Hide Lines hid there.
 */
const clicks = EditorView.domEventHandlers({
  mousedown (event, view) {
    if (event.button !== 0 || event.shiftKey || event.metaKey || event.altKey) return false
    const element = event.target instanceof Element ? event.target : null
    const button = element?.closest('.lo-hidden-lines')
    if (button) {
      const pos = view.posAtDOM(button)
      const shown = view.state.field(enhancedField).hiddenSelections
        .filter((range) => range.from <= pos && pos <= range.to)
      if (!shown.length) return false
      view.dispatch({ effects: shown.map((range) => selectionShown.of(range.from)) })
      event.preventDefault()
      return true
    }
    const target = element?.closest('.lo-disclosure')
    if (!target) return false
    const doc = view.state.doc
    const owner = ownerOnLine(view.state.field(enhancedField), doc.lineAt(view.posAtDOM(target)).number - 1)
    if (!owner) return false
    view.dispatch({ ...arrowClick(doc, owner), userEvent: DISCLOSE })
    moveSelectionOutOfHidden(view)
    event.preventDefault()
    return true
  },
})

// MARK: - Hide Lines and Show Lines

/** The 0-based lines `range` covers; a selection ending at the very start of a line leaves that line out. */
function linesCoveredBy (doc, range) {
  const end = range.to > range.from && doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to
  return { first: doc.lineAt(range.from).number - 1, last: doc.lineAt(end).number - 1 }
}

/**
 * The innermost task or disclosure around line `index` whose body is showing — its arrow open, or
 * closed but revealed by Find or an edit — or null.
 */
function innermostShowing (value, index) {
  const showing = [...value.tasks, ...value.disclosures].filter((owner) => owner.body &&
    (owner.open || value.revealed.has(owner.pos)) && owner.line <= index && index <= owner.lastLine)
  return showing.reduce((inner, owner) => (!inner || owner.line > inner.line ? owner : inner), null)
}

/**
 * ⌘[, Hide Lines, as VS Code's Fold and Fold Selection. A caret closes the innermost arrow around
 * it whose body is showing — the same edit as a click on it, so ⌘Z opens it again — and pressing
 * again closes the next arrow out. A selection over several lines keeps its first line and hides
 * the rest: by closing the first line's arrow when it has one, and otherwise on screen only,
 * nothing written to the file, with ⋯ after the first line to show them again. A selection
 * reaching into what is hidden goes to the end of the line it is drawn on. False when nothing
 * hides.
 */
export function hideLines (view) {
  const { state } = view
  const doc = state.doc
  const value = state.field(enhancedField)
  const owners = new Map()
  const selections = []
  for (const range of state.selection.ranges) {
    const { first, last } = linesCoveredBy(doc, range)
    if (first === last) {
      const owner = innermostShowing(value, first)
      if (owner) owners.set(owner.pos, owner)
      continue
    }
    const owner = ownerOnLine(value, first)
    if (owner && (owner.open || value.revealed.has(owner.pos))) owners.set(owner.pos, owner)
    else if (!owner || !owner.body) selections.push({ from: doc.line(first + 1).to, to: doc.line(last + 1).to })
  }
  if (!owners.size && !selections.length) return false
  const clicked = [...owners.values()].map((owner) => owner.open ? arrowClick(doc, owner) : { effects: arrowClicked.of(owner.pos) })
  view.dispatch({
    changes: clicked.flatMap((click) => click.changes ?? []),
    effects: [...clicked.map((click) => click.effects), ...selections.map((range) => selectionHidden.of(range))],
    userEvent: DISCLOSE,
  })
  moveSelectionOutOfHidden(view)
  return true
}

/**
 * ⌘], Show Lines, as VS Code's Unfold: with the caret on a line with ⋯ after it, shows the lines
 * Hide Lines hid there; otherwise, on a closed arrow's line, opens the arrow, the same edit as a
 * click on it. False when nothing shows.
 */
export function showLines (view) {
  const { state } = view
  const doc = state.doc
  const value = state.field(enhancedField)
  const shown = new Set()
  const owners = new Map()
  for (const range of state.selection.ranges) {
    const line = doc.lineAt(range.head)
    const hiddenHere = value.hiddenSelections.filter((hidden) => hidden.from === line.to)
    for (const hidden of hiddenHere) shown.add(hidden.from)
    const owner = hiddenHere.length ? null : ownerOnLine(value, line.number - 1)
    if (owner && !owner.open) owners.set(owner.pos, owner)
  }
  if (!shown.size && !owners.size) return false
  const clicked = [...owners.values()].map((owner) => arrowClick(doc, owner))
  view.dispatch({
    changes: clicked.map((click) => click.changes),
    effects: [...clicked.map((click) => click.effects), ...[...shown].map((from) => selectionShown.of(from))],
    userEvent: DISCLOSE,
  })
  return true
}

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
