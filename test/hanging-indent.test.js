import { describe, it, expect } from 'vitest'
import { indentColumns } from '../src/renderer/editor/hanging-indent.js'

describe('indentColumns', () => {
  it('counts leading spaces', () => {
    expect(indentColumns('    text  more', 4)).toBe(4)
    expect(indentColumns('text', 4)).toBe(0)
    expect(indentColumns('', 4)).toBe(0)
  })

  it('takes a tab to the next tab stop', () => {
    expect(indentColumns('\ttext', 4)).toBe(4)
    expect(indentColumns('  \ttext', 4)).toBe(4)
    expect(indentColumns('\t  text', 4)).toBe(6)
    expect(indentColumns('\t\ttext', 2)).toBe(4)
  })

  it('counts a line of only whitespace whole', () => {
    expect(indentColumns('   ', 4)).toBe(3)
  })
})
