import { describe, it, expect } from 'vitest'
import {
  parseArrow, reservedLines, parseDisclosures, hiddenLines, arrowFlip, arrowsOnLine, liveArrows,
  openingEdits,
} from '../src/renderer/editor/disclosures.js'
import { parseTasks } from '../src/renderer/editor/enhanced-tasks.js'

// The user's first example.
const EXAMPLE = [
  'submission_to_tribunal_date* --v',
  '  Type: date',
  '  Width in Sixths: 3 --v',
  '    More Detail Here: ;lkjlkajsfdf',
  'next line',
]

const parse = (lines) => parseDisclosures(lines, { skip: reservedLines(lines) })
const shape = (disclosures) => disclosures.map((d) => [d.line, d.body, d.children.map((child) => child.line)])
const apply = (lines, edits) => {
  const out = [...lines]
  for (const { line, column, char } of edits) out[line] = out[line].slice(0, column) + char + out[line].slice(column + 1)
  return out
}

describe('the arrow', () => {
  it('starts the line or follows whitespace, and is followed by whitespace or the end of the line', () => {
    expect(parseArrow('Thread -->')).toEqual({ column: 7, open: false, indent: 0 })
    expect(parseArrow('  Thread --v   ')).toEqual({ column: 9, open: true, indent: 2 })
    expect(parseArrow('    -->')).toEqual({ column: 4, open: false, indent: 4 })
    expect(parseArrow('Thread-->')).toBeNull()
    expect(parseArrow('--> Thread')).toEqual({ column: 0, open: false, indent: 0 })
    expect(parseArrow('==v Thread')).toEqual({ column: 0, open: true, indent: 0 })
    // Alone in the first column it ends an HTML comment.
    expect(parseArrow('-->')).toBeNull()
    expect(parseArrow('-->  ')).toBeNull()
    expect(parseArrow('run --verbose')).toBeNull()
    expect(parseArrow('a -->b')).toBeNull()
  })

  it('sits anywhere on the line, the first one counting', () => {
    expect(parseArrow('a --> b')).toEqual({ column: 2, open: false, indent: 0 })
    expect(parseArrow('  a --v b --> c')).toEqual({ column: 4, open: true, indent: 2 })
    expect(parseArrow('x-->y --> z')).toEqual({ column: 6, open: false, indent: 0 })
  })

  it('may be the double arrow, off a task line', () => {
    expect(parseArrow('Plan ==> the week')).toEqual({ column: 5, open: false, indent: 0 })
    expect(parseArrow('Plan ==v')).toEqual({ column: 5, open: true, indent: 0 })
    expect(parseArrow('a <==> b')).toBeNull()
  })

  it('is not one after `<!--` on its line', () => {
    expect(parseArrow('<!-- x -->')).toBeNull()
    expect(parseArrow('text <!-- a note -->')).toBeNull()
    expect(parseDisclosures(['<!-- x -->', '  indented'])).toEqual([])
  })
})

describe('the user’s example', () => {
  it('two levels, and `next line` ends it', () => {
    const disclosures = parse(EXAMPLE)
    expect(shape(disclosures)).toEqual([[0, [1, 3], [2]], [2, [3, 3], []]])
    expect(disclosures[0]).toMatchObject({ column: 29, open: true, indent: 0, lastLine: 3 })
    expect(disclosures[1]).toMatchObject({ column: 21, open: true, indent: 2, lastLine: 3 })
  })

  it('the same text indented by fours reads the same', () => {
    const lines = EXAMPLE.map((line) => line.replace(/^ +/, (spaces) => ' '.repeat(spaces.length * 2)))
    expect(shape(parse(lines))).toEqual([[0, [1, 3], [2]], [2, [3, 3], []]])
  })

  it('closing the outer arrow hides the nested one with it', () => {
    const closed = apply(EXAMPLE, [arrowFlip(parse(EXAMPLE)[0])])
    expect(closed[0]).toBe('submission_to_tribunal_date* -->')
    const [outer, inner] = parse(closed)
    expect(hiddenLines(outer)).toEqual([{ first: 1, last: 3 }])
    expect(hiddenLines(inner)).toEqual([])
  })

  it('closing the inner arrow hides only its own line', () => {
    const closed = apply(EXAMPLE, [arrowFlip(parse(EXAMPLE)[1])])
    expect(closed[2]).toBe('  Width in Sixths: 3 -->')
    const [outer, inner] = parse(closed)
    expect(hiddenLines(outer)).toEqual([])
    expect(hiddenLines(inner)).toEqual([{ first: 3, last: 3 }])
  })
})

describe('where a body ends', () => {
  it('not at one blank line with a deeper line after it, even one with spaces', () => {
    expect(shape(parse(['a -->', '  b', '', '  c']))).toEqual([[0, [1, 3], []]])
    expect(shape(parse(['a -->', '  b', '   ', '  c']))).toEqual([[0, [1, 3], []]])
    expect(shape(parse(['a -->', '', '  b']))).toEqual([[0, [1, 2], []]])
  })

  it('at two blank lines in a row, or a blank line with nothing deeper after it', () => {
    expect(shape(parse(['a -->', '  b', '', '', '  c']))).toEqual([[0, [1, 1], []]])
    expect(shape(parse(['a -->', '  b', '', 'c']))).toEqual([[0, [1, 1], []]])
    expect(shape(parse(['a -->', '  b', '']))).toEqual([[0, [1, 1], []]])
    expect(shape(parse(['a -->', '', '', '  b']))).toEqual([[0, null, []]])
  })

  it('a nested body takes a gap only when its own deeper lines follow', () => {
    expect(shape(parse(['a -->', '  b -->', '    c', '', '    d', '', '  e'])))
      .toEqual([[0, [1, 6], [1]], [1, [2, 4], []]])
  })

  it('at a line no deeper than the arrow’s', () => {
    expect(shape(parse(['a -->', '  b', 'c', '  d']))).toEqual([[0, [1, 1], []]])
    expect(shape(parse(['  a -->', '    b', '  c']))).toEqual([[0, [1, 1], []]])
    expect(shape(parse(['a -->', '\tb']))).toEqual([[0, null, []]])
  })

  it('takes every deeper line, arrow above it or not, at any indent', () => {
    expect(shape(parse(['a -->', '  b', '      deep', '  c', 'd']))).toEqual([[0, [1, 3], []]])
    expect(shape(parse(['a -->', '   three', '  two', ' one']))).toEqual([[0, [1, 3], []]])
  })

  it('the user’s field example: closing the top arrow hides everything under it', () => {
    const lines = [
      'primary_person_id -->',
      '  label: The Child',
      '  type: text',
      '  related-to: people table',
      '  people-fields:',
      '    title --v',
      '      label: Title',
      '      type: text',
      '      width-in-sixths: 1',
    ]
    const [outer, inner] = parse(lines)
    expect(shape([outer, inner])).toEqual([[0, [1, 8], [5]], [5, [6, 8], []]])
    expect(hiddenLines(outer)).toEqual([{ first: 1, last: 8 }])
  })

  it('carries on after a nested body back at its own indent', () => {
    expect(shape(parse(['a --v', '  b -->', '    c', '    d', '  e', 'f'])))
      .toEqual([[0, [1, 4], [1]], [1, [2, 3], []]])
  })

  it('nests three deep', () => {
    expect(shape(parse(['a --v', '  b --v', '    c --v', '      d', '  e'])))
      .toEqual([[0, [1, 4], [1]], [1, [2, 3], [2]], [2, [3, 3], []]])
  })

  it('a disclosure with no body is still one, and flips', () => {
    const [only] = parse(['alone -->', 'next'])
    expect(only).toMatchObject({ line: 0, body: null, lastLine: 0 })
    expect(hiddenLines(only)).toEqual([])
    expect(arrowFlip(only)).toEqual({ line: 0, column: 8, char: 'v' })
  })

  it('an indented line may be one on its own', () => {
    expect(shape(parse(['plain', '    deep -->', '      under']))).toEqual([[1, [2, 2], []]])
  })
})

describe('with enhanced tasks', () => {
  const TASK = [
    '[[ ]] ==v (()) do something agent',
    '  This is the description.',
    '  Email id: 5678987656789',
    '  Thread --v',
    '    id: abc',
    '  [ ] send an email',
    '  [ ] ',
  ]

  it('a line under a task may end in an arrow that owns the lines deeper under it', () => {
    const disclosures = parse(TASK)
    expect(shape(disclosures)).toEqual([[3, [4, 4], []]])
    expect(disclosures[0].indent).toBe(2)
  })

  it('a closed Thread hides only its own body', () => {
    const closed = apply(TASK, [arrowFlip(parse(TASK)[0])])
    expect(hiddenLines(parse(closed)[0])).toEqual([{ first: 4, last: 4 }])
  })

  it('the task line is never a disclosure, and ends a body above it', () => {
    const lines = ['notes -->', '  under', '[[ ]] ==v (()) title -->', '  about']
    expect(reservedLines(lines)).toEqual(new Set([2]))
    expect(shape(parse(lines))).toEqual([[0, [1, 1], []]])
  })

  it('a plain to-do line may end in an arrow like any other', () => {
    expect(shape(parse(['[ ] milk -->', '  semi-skimmed']))).toEqual([[0, [1, 1], []]])
  })
})

describe('typed arrows open', () => {
  it('reads the arrows a line could have, by text alone', () => {
    expect(arrowsOnLine('[[ ]] ==> (()) title -->')).toEqual([{ column: 6, open: false }])
    expect(arrowsOnLine('a --> b --v')).toEqual([{ column: 2, open: false }])
    expect(arrowsOnLine('  Thread --v')).toEqual([{ column: 9, open: true }])
    expect(arrowsOnLine('Thread')).toEqual([])
  })

  it('lists the live arrows, the task’s and the disclosures’, but not a title’s end', () => {
    const lines = ['[[ ]] ==> (()) T -->', '  about -->', '    id', 'x <!-- y -->', 'z -->']
    const key = (arrow) => `${arrow.line}:${arrow.column}`
    expect(liveArrows(lines).map(key).sort()).toEqual(['0:6', '1:8', '4:2'])
  })

  it('opens the closed arrows that were not there before, and only those', () => {
    const lines = ['a -->', 'b -->', 'c --v', '[[ ]] ==> (())']
    const existed = (arrow) => arrow.line === 0
    expect(openingEdits(liveArrows(lines), existed)).toEqual(expect.arrayContaining([
      { line: 1, column: 4, char: 'v' }, { line: 3, column: 8, char: 'v' },
    ]))
    expect(openingEdits(liveArrows(lines), existed)).toHaveLength(2)
  })
})

describe('where an arrow can sit', () => {
  it('is a button anywhere on a line but a task line, whose own arrow is the task’s', () => {
    const lines = [
      'a --> b',
      '- item --> more',
      'text-->',
      'x -->',
      '[ ] milk -->',
      '[[ ]] ==> (()) task title -->',
      '  desc',
      'notes ==v for Monday',
    ]
    const found = parseDisclosures(lines, { skip: reservedLines(lines) }).map((d) => d.line)
    expect(found).toEqual([0, 1, 3, 4, 7])
    expect(parseTasks(lines).map((task) => [task.line, task.arrowColumn])).toEqual([[5, 6]])
  })
})
