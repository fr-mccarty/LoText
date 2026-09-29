import { describe, it, expect } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { insertNewlineKeepingIndent } from '../src/renderer/editor/line-editing.js'

/** Return pressed at each `|` in `marked`; the text afterwards, with `|` at each caret. */
function pressReturn (marked) {
  const parts = marked.split('|')
  const carets = []
  let doc = parts[0]
  for (const part of parts.slice(1)) { carets.push(doc.length); doc += part }
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create(carets.map((at) => EditorSelection.cursor(at))),
    extensions: EditorState.allowMultipleSelections.of(true),
  })
  insertNewlineKeepingIndent({ state, dispatch: (spec) => { state = state.update(spec).state } })
  let text = state.doc.toString()
  for (const range of [...state.selection.ranges].reverse()) text = `${text.slice(0, range.head)}|${text.slice(range.head)}`
  return text
}

describe('Return keeps the line’s indentation', () => {
  it('starts the new line as many tabs deep, as tabs', () => {
    expect(pressReturn('\t\tabc|')).toBe('\t\tabc\n\t\t|')
  })

  it('keeps spaces as spaces, and a mix exactly as it was', () => {
    expect(pressReturn('    abc|')).toBe('    abc\n    |')
    expect(pressReturn('  \tabc|')).toBe('  \tabc\n  \t|')
  })

  it('adds nothing after an unindented line', () => {
    expect(pressReturn('abc|')).toBe('abc\n|')
  })

  it('carries the rest of a split line to the same depth', () => {
    expect(pressReturn('\tab |cd')).toBe('\tab \n\t|cd')
  })

  it('moves an indent-only line’s indent down, leaving a truly blank line', () => {
    expect(pressReturn('\t\tabc\n\t\t|')).toBe('\t\tabc\n\n\t\t|')
  })

  it('pushes a line down whole when the caret is at the start of its text', () => {
    expect(pressReturn('\t|abc')).toBe('\n\t|abc')
  })

  it('replaces a selection', () => {
    let state = EditorState.create({ doc: '\tone two', selection: EditorSelection.range(4, 8) })
    insertNewlineKeepingIndent({ state, dispatch: (spec) => { state = state.update(spec).state } })
    expect(state.doc.toString()).toBe('\tone\n\t')
  })

  it('works at every caret', () => {
    expect(pressReturn('\ta|\n    b|')).toBe('\ta\n\t|\n    b\n    |')
  })
})
