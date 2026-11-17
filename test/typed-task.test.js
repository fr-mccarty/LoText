import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { enhancedTasks, enhancedField } from '../src/renderer/editor/enhanced-view.js'

/** Type `text` at `at` in `doc`, one character at a time, as the keyboard would. */
function type (doc, text, at = doc.length) {
  let state = EditorState.create({ doc, extensions: enhancedTasks, selection: { anchor: at } })
  for (const char of text) {
    const head = state.selection.main.head
    state = state.update({ changes: { from: head, insert: char }, selection: { anchor: head + 1 }, userEvent: 'input.type' }).state
  }
  return state
}

/** Replace the one character at `at`, as a click on a box or an arrow does. */
function replace (doc, at, char) {
  const state = EditorState.create({ doc, extensions: enhancedTasks })
  return state.update({ changes: { from: at, to: at + 1, insert: char }, userEvent: 'input' }).state
}

/** The hidden lines of each task, 1-based, as the view has them. */
function hiddenLineNumbers (state) {
  return state.field(enhancedField).tasks.map((task) =>
    task.ranges.map(({ from, to }) => [state.doc.lineAt(from).number + 1, state.doc.lineAt(to).number]))
}

describe('a task typed in the editor', () => {
  it('arrives expanded: a typed `==>` is written `==v`, caret after it', () => {
    const state = type('[ ] ', '==> ( )')
    expect(state.doc.toString()).toBe('[ ] ==v ( )')
  })

  it('leaves a collapsed arrow already in the file as it is', () => {
    const state = type('[ ] ==> ( ) call', ' Ann')
    expect(state.doc.toString()).toBe('[ ] ==> ( ) call Ann')
  })
})

describe('checking the task', () => {
  const doc = '[ ] ==v ( ) T\n  description\n  [ ] a\nat the edge\n[ ] ==v ( ) next\n  more'

  it('collapses it in the same edit, hiding the lines indented under it', () => {
    const state = replace(doc, 1, 'x')
    expect(state.doc.line(1).text).toBe('[x] ==> ( ) T')
    expect(state.doc.line(5).text).toBe('[ ] ==v ( ) next')
    expect(hiddenLineNumbers(state)).toEqual([[[2, 3]], []])
  })

  it('unchecking changes no arrow', () => {
    const state = replace('[x] ==> ( ) T\n  d', 1, ' ')
    expect(state.doc.toString()).toBe('[ ] ==> ( ) T\n  d')
  })
})

describe('the choices', () => {
  it('typing into an empty choice checks it', () => {
    const doc = '[ ] ==v ( ) T\n  [ ] '
    expect(type(doc, 'send it').doc.toString()).toBe('[ ] ==v ( ) T\n  [x] send it')
  })

  it('an empty box outside a task stays empty', () => {
    expect(type('notes\n  [ ] ', 'milk').doc.toString()).toBe('notes\n  [ ] milk')
  })
})

describe('an arrow typed anywhere on a line', () => {
  const foldedCount = (state) => state.field(enhancedField).disclosures.filter((d) => !d.open && d.body).length

  it('in the middle arrives expanded and stays so as typing goes on', () => {
    const state = type('Plan\n  Monday', ' --> week', 4)
    expect(state.doc.toString()).toBe('Plan --v week\n  Monday')
    expect(foldedCount(state)).toBe(0)
  })

  it('the double arrow too, off a task line', () => {
    const state = type('Plan\n  Monday', ' ==> week', 4)
    expect(state.doc.toString()).toBe('Plan ==v week\n  Monday')
  })

  it('at the start of a line arrives expanded', () => {
    const state = type('Plan\n  Monday', '--> ', 0)
    expect(state.doc.toString()).toBe('--v Plan\n  Monday')
    expect(foldedCount(state)).toBe(0)
  })

  it('leaves a second arrow on the line as typed', () => {
    const state = type('a --v b\n  c', ' -->', 7)
    expect(state.doc.toString()).toBe('a --v b -->\n  c')
  })
})
