import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { enhancedTasks } from '../src/renderer/editor/enhanced-view.js'
import { cutWholeLines } from '../src/renderer/editor/line-editing.js'

let clipboard
beforeEach(() => {
  clipboard = null
  vi.stubGlobal('navigator', { clipboard: { writeText: async (text) => { clipboard = text } } })
})

/** ⌘X with carets at `carets` in `lines`; the text left and what went to the clipboard. */
async function cut (lines, ...carets) {
  const doc = lines.join('\n')
  let state = EditorState.create({
    doc,
    extensions: [enhancedTasks, EditorState.allowMultipleSelections.of(true)],
    selection: EditorSelection.create(carets.map(([line, column]) =>
      EditorSelection.cursor(state0Line(doc, line) + column))),
  })
  const view = { get state () { return state }, dispatch: (spec) => { state = state.update(spec).state } }
  expect(cutWholeLines(view)).toBe(true)
  await new Promise((resolve) => setTimeout(resolve))
  return { left: state.doc.toString().split('\n'), clipboard }
}
const state0Line = (doc, line) => doc.split('\n').slice(0, line).reduce((at, text) => at + text.length + 1, 0)

describe('⌘X on a collapsed item', () => {
  it('cuts a collapsed enhanced task whole, down to the next task', async () => {
    const { left, clipboard } = await cut([
      '[[ ]] ==> (()) first',
      '  its description',
      '  [ ] a choice',
      '[[ ]] ==v (()) second',
      '  kept',
    ], [0, 3])
    expect(clipboard).toBe('[[ ]] ==> (()) first\n  its description\n  [ ] a choice\n')
    expect(left).toEqual(['[[ ]] ==v (()) second', '  kept'])
  })

  it('cuts a collapsed disclosure with its whole body, nested arrows and all', async () => {
    const { left, clipboard } = await cut([
      'before',
      'Groceries -->',
      '  milk',
      '  fruit --v',
      '    apples',
      'after',
    ], [1, 0])
    expect(clipboard).toBe('Groceries -->\n  milk\n  fruit --v\n    apples\n')
    expect(left).toEqual(['before', 'after'])
  })

  it('cuts only the line of an expanded item, as for any line', async () => {
    const { left, clipboard } = await cut(['Groceries --v', '  milk', 'after'], [0, 2])
    expect(clipboard).toBe('Groceries --v\n')
    expect(left).toEqual(['  milk', 'after'])
  })

  it('cuts a collapsed item at the end of the file, taking the newline before it', async () => {
    const { left, clipboard } = await cut(['top', 'Groceries -->', '  milk'], [1, 0])
    expect(clipboard).toBe('Groceries -->\n  milk\n')
    expect(left).toEqual(['top'])
  })

  it('cuts a collapsed item and an ordinary line under two carets', async () => {
    const { left, clipboard } = await cut(['plain', 'Groceries -->', '  milk', 'after'], [0, 0], [1, 4])
    expect(clipboard).toBe('plain\nGroceries -->\n  milk\n')
    expect(left).toEqual(['after'])
  })

  it('leaves the next collapsed item collapsed, so a second ⌘X cuts it whole too', async () => {
    let state = EditorState.create({
      doc: ['before', 'Groceries -->', '  milk', '[[ ]] ==> (()) Call the plumber', '  about the sink', '[[ ]] ==v (()) next'].join('\n'),
      extensions: enhancedTasks,
      selection: { anchor: 9 },
    })
    const view = { get state () { return state }, dispatch: (spec) => { state = state.update(spec).state } }
    cutWholeLines(view)
    await new Promise((resolve) => setTimeout(resolve))
    view.dispatch({ selection: { anchor: state.doc.line(2).from + 2 } })
    cutWholeLines(view)
    await new Promise((resolve) => setTimeout(resolve))
    expect(clipboard).toBe('[[ ]] ==> (()) Call the plumber\n  about the sink\n')
    expect(state.doc.toString()).toBe('before\n[[ ]] ==v (()) next')
  })

  it('leaves an ordinary line’s cut as it was', async () => {
    const { left, clipboard } = await cut(['one', 'two', 'three'], [1, 1])
    expect(clipboard).toBe('two\n')
    expect(left).toEqual(['one', 'three'])
  })
})
