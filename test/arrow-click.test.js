import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { history } from '@codemirror/commands'
import { enhancedTasks, foldedRanges, clickArrow, restoreSelection } from '../src/renderer/editor/enhanced-view.js'

/** An editor over `lines`, the caret at the start, as a file is loaded. */
function editorOver (lines) {
  let state = EditorState.create({ doc: lines.join('\n'), extensions: [history(), enhancedTasks] })
  return {
    get state () { return state },
    dispatch: (...specs) => { state = state.update(...specs).state },
  }
}

const textOf = (view) => view.state.doc.toString().split('\n')
const at = (view, line, column = 0) => view.state.doc.line(line + 1).from + column

/** The hidden lines, 0-based and inclusive, as [first, last]. */
const hiddenLines = (view) => foldedRanges(view.state).map(({ from, to }) =>
  [view.state.doc.lineAt(from).number, view.state.doc.lineAt(to).number - 1])

const DAY = [
  '[ ] ==> ( ) Call Ann',
  '  her number',
  '  [ ] ring',
  '  Groceries -->',
  '    milk',
]

describe('a click on an arrow', () => {
  it('shows and hides what an enhanced task holds', () => {
    const view = editorOver(DAY.slice(0, 3))
    expect(hiddenLines(view)).toEqual([[1, 2]])
    clickArrow(view, 0)
    expect(textOf(view)[0]).toBe('[ ] ==v ( ) Call Ann')
    expect(hiddenLines(view)).toEqual([])
    clickArrow(view, 0)
    expect(textOf(view)[0]).toBe('[ ] ==> ( ) Call Ann')
    expect(hiddenLines(view)).toEqual([[1, 2]])
  })

  it('shows and hides what a disclosure arrow holds', () => {
    const view = editorOver(DAY.slice(3))
    clickArrow(view, 0)
    expect(textOf(view)[0]).toBe('  Groceries --v')
    expect(hiddenLines(view)).toEqual([])
    clickArrow(view, 0)
    expect(hiddenLines(view)).toEqual([[1, 1]])
  })

  it('moves a caret out of what it hides', () => {
    const view = editorOver(['[ ] ==v ( ) Call Ann', '  her number'])
    view.dispatch({ selection: EditorSelection.cursor(at(view, 1, 4)) })
    clickArrow(view, 0)
    expect(view.state.selection.main.head).toBe(view.state.doc.line(1).to)
  })

  it('is nothing on a line with no arrow', () => {
    const view = editorOver(['plain', '  under'])
    expect(clickArrow(view, 0)).toBe(false)
  })
})

describe('a caret put back inside hidden lines', () => {
  it('on reopening a file leaves them hidden, so the arrow’s click shows them', () => {
    const view = editorOver(DAY)
    restoreSelection(view, { selection: { anchor: at(view, 1, 4) } })
    expect(hiddenLines(view)).toEqual([[1, 4]])
    expect(view.state.selection.main.head).toBe(view.state.doc.line(1).to)
    clickArrow(view, 0)
    expect(textOf(view)[0]).toBe('[ ] ==v ( ) Call Ann')
    expect(hiddenLines(view)).toEqual([[4, 4]])
    clickArrow(view, 0)
    expect(hiddenLines(view)).toEqual([[1, 4]])
  })

  it('in a disclosure leaves it hidden too', () => {
    const view = editorOver(DAY.slice(3))
    restoreSelection(view, { selection: { anchor: at(view, 1, 5) } })
    expect(hiddenLines(view)).toEqual([[1, 1]])
    clickArrow(view, 0)
    expect(hiddenLines(view)).toEqual([])
  })

  it('by a reload from disk that collapsed a task leaves it hidden', () => {
    const view = editorOver(['[ ] ==v ( ) Call Ann', '  her number', '  [ ] ring'])
    view.dispatch({ selection: EditorSelection.cursor(at(view, 1, 4)) })
    const text = '[ ] ==> ( ) Call Ann\n  her number\n  [ ] ring'
    restoreSelection(view, {
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: view.state.selection.main.head },
    })
    expect(hiddenLines(view)).toEqual([[1, 2]])
    clickArrow(view, 0)
    expect(hiddenLines(view)).toEqual([])
  })

  it('by Find still shows them, the arrow unchanged', () => {
    const view = editorOver(DAY)
    view.dispatch({ selection: EditorSelection.cursor(at(view, 1, 4)) })
    expect(textOf(view)[0]).toBe(DAY[0])
    // The closed arrow inside the task keeps its lines hidden.
    expect(hiddenLines(view)).toEqual([[4, 4]])
  })

  it('shown by Find hide again at a click on the arrow, which stays as it is', () => {
    const view = editorOver(DAY)
    view.dispatch({ selection: EditorSelection.cursor(at(view, 1, 4)) })
    clickArrow(view, 0)
    expect(textOf(view)[0]).toBe(DAY[0])
    expect(hiddenLines(view)).toEqual([[1, 4]])
    expect(view.state.selection.main.head).toBe(view.state.doc.line(1).to)
    clickArrow(view, 0)
    expect(textOf(view)[0]).toBe('[ ] ==v ( ) Call Ann')
    expect(hiddenLines(view)).toEqual([[4, 4]])
  })

  it('shown by an edit hide again at a click on a disclosure arrow', () => {
    const view = editorOver(DAY.slice(3))
    view.dispatch({ changes: { from: at(view, 1, 4), insert: 'oat ' } })
    expect(hiddenLines(view)).toEqual([])
    clickArrow(view, 0)
    expect(textOf(view)).toEqual(['  Groceries -->', '    oat milk'])
    expect(hiddenLines(view)).toEqual([[1, 1]])
  })
})

describe('the [ ] box', () => {
  it('checked, collapses its task in the same edit', () => {
    const view = editorOver(['[ ] ==v ( ) Call Ann', '  her number'])
    view.dispatch({ changes: { from: 1, to: 2, insert: 'x' }, userEvent: 'input' })
    expect(textOf(view)[0]).toBe('[x] ==> ( ) Call Ann')
    expect(hiddenLines(view)).toEqual([[1, 1]])
  })
})
