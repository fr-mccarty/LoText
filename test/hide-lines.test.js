import { describe, it, expect, vi } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { undo, history } from '@codemirror/commands'
import { enhancedTasks, hideLines, showLines, foldedRanges, moveItems } from '../src/renderer/editor/enhanced-view.js'
import { cutWholeLines } from '../src/renderer/editor/line-editing.js'

/** An editor over `lines` with the selection from [line, column] to [line, column], 0-based. */
function editorOver (lines, [anchorLine, anchorColumn], [headLine, headColumn] = [anchorLine, anchorColumn]) {
  const doc = lines.join('\n')
  const at = (line, column) => doc.split('\n').slice(0, line).reduce((pos, text) => pos + text.length + 1, 0) + column
  let state = EditorState.create({
    doc,
    extensions: [history(), enhancedTasks],
    selection: EditorSelection.single(at(anchorLine, anchorColumn), at(headLine, headColumn)),
  })
  return {
    get state () { return state },
    dispatch: (...specs) => { state = state.update(...specs).state },
  }
}

const textOf = (view) => view.state.doc.toString().split('\n')

/** The hidden lines, 1-based and inclusive, as [first, last]. */
const hiddenLineNumbers = (view) => foldedRanges(view.state).map(({ from, to }) =>
  [view.state.doc.lineAt(from).number + 1, view.state.doc.lineAt(to).number])

const GROCERIES = [
  'Groceries --v',
  '  milk',
  '  fruit --v',
  '    apples',
  'after',
]

describe('Hide Lines with a caret', () => {
  it('closes the innermost open arrow around the caret, as a click does', () => {
    const view = editorOver(GROCERIES, [3, 2])
    expect(hideLines(view)).toBe(true)
    expect(textOf(view)[2]).toBe('  fruit -->')
    expect(hiddenLineNumbers(view)).toEqual([[4, 4]])
    // The caret was in what hides, so it goes to the end of the arrow's line.
    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).to)
  })

  it('closes the next arrow out when pressed again', () => {
    const view = editorOver(GROCERIES, [3, 2])
    hideLines(view)
    hideLines(view)
    expect(textOf(view)[0]).toBe('Groceries -->')
    expect(hiddenLineNumbers(view)).toEqual([[2, 4]])
  })

  it('closes an enhanced task around the caret', () => {
    const view = editorOver(['[[ ]] ==v (()) call Ann', '  her number', '[[ ]] ==v (()) next'], [1, 3])
    hideLines(view)
    expect(textOf(view)[0]).toBe('[[ ]] ==> (()) call Ann')
  })

  it('is undone by one ⌘Z', () => {
    const view = editorOver(GROCERIES, [0, 3])
    hideLines(view)
    undo(view)
    expect(textOf(view)).toEqual(GROCERIES)
  })

  it('does nothing outside every arrow', () => {
    const view = editorOver(GROCERIES, [4, 1])
    expect(hideLines(view)).toBe(false)
    expect(textOf(view)).toEqual(GROCERIES)
  })

  it('hides again an arrow Find has opened, without rewriting it', () => {
    const lines = ['Groceries -->', '  milk', 'after']
    const view = editorOver(lines, [0, 0])
    // A caret dropped into the hidden line, as Find does, shows it.
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 3 } })
    expect(hiddenLineNumbers(view)).toEqual([])
    hideLines(view)
    expect(textOf(view)).toEqual(lines)
    expect(hiddenLineNumbers(view)).toEqual([[2, 2]])
  })
})

describe('Hide Lines with a selection over several lines', () => {
  const PLAIN = ['intro', 'one', 'two', 'three', 'outro']

  it('keeps the first line and hides the rest, writing nothing to the file', () => {
    const view = editorOver(PLAIN, [1, 0], [3, 2])
    hideLines(view)
    expect(textOf(view)).toEqual(PLAIN)
    expect(hiddenLineNumbers(view)).toEqual([[3, 4]])
    expect(view.state.selection.main.head).toBe(view.state.doc.line(2).to)
  })

  it('leaves out a last line the selection only reaches the start of', () => {
    const view = editorOver(PLAIN, [1, 0], [4, 0])
    hideLines(view)
    expect(hiddenLineNumbers(view)).toEqual([[3, 4]])
  })

  it('closes the first line’s arrow when it has one', () => {
    const view = editorOver(GROCERIES, [0, 0], [3, 4])
    hideLines(view)
    expect(textOf(view)[0]).toBe('Groceries -->')
  })

  it('shows the lines again when an edit reaches into them', () => {
    const view = editorOver(PLAIN, [1, 0], [3, 2])
    hideLines(view)
    // ⌫ at the start of the line below the hidden ones.
    const below = view.state.doc.line(5).from
    view.dispatch({ changes: { from: below - 1, to: below }, userEvent: 'delete.backward' })
    expect(hiddenLineNumbers(view)).toEqual([])
  })

  it('stays hidden while the line above is typed on', () => {
    const view = editorOver(PLAIN, [1, 0], [3, 2])
    hideLines(view)
    const end = view.state.doc.line(2).to
    view.dispatch({ changes: { from: end, insert: '!' }, userEvent: 'input.type' })
    expect(textOf(view)[1]).toBe('one!')
    expect(hiddenLineNumbers(view)).toEqual([[3, 4]])
  })

  it('shows the lines again when ⌥↓ moves a line into their place', () => {
    const view = editorOver(PLAIN, [1, 0], [3, 2])
    hideLines(view)
    view.dispatch({ selection: { anchor: 0 } })
    moveItems(view, 1)
    expect(hiddenLineNumbers(view)).toEqual([])
  })
})

describe('⌘X on the line above hidden lines', () => {
  it('cuts the line with the lines hidden under it', async () => {
    let clipboard = null
    vi.stubGlobal('navigator', { clipboard: { writeText: async (text) => { clipboard = text } } })
    const view = editorOver(['intro', 'one', 'two', 'outro'], [1, 0], [2, 3])
    hideLines(view)
    cutWholeLines(view)
    await new Promise((resolve) => setTimeout(resolve))
    expect(clipboard).toBe('one\ntwo\n')
    expect(textOf(view)).toEqual(['intro', 'outro'])
    vi.unstubAllGlobals()
  })
})

describe('Show Lines', () => {
  it('shows lines Hide Lines hid under the caret’s line', () => {
    const view = editorOver(['intro', 'one', 'two', 'outro'], [1, 0], [2, 3])
    hideLines(view)
    expect(showLines(view)).toBe(true)
    expect(hiddenLineNumbers(view)).toEqual([])
  })

  it('opens a closed arrow on the caret’s line, as a click does', () => {
    const view = editorOver(['Groceries -->', '  milk', 'after'], [0, 2])
    showLines(view)
    expect(textOf(view)[0]).toBe('Groceries --v')
    expect(hiddenLineNumbers(view)).toEqual([])
  })

  it('does nothing on a line with nothing hidden under it', () => {
    const view = editorOver(GROCERIES, [1, 2])
    expect(showLines(view)).toBe(false)
  })
})
