import { describe, it, expect } from 'vitest'
import { moveBlocks } from '../src/renderer/editor/move-items.js'

const UP = -1
const DOWN = 1
const at = (first, last = first) => ({ first, last })
const move = (lines, ranges, direction) => moveBlocks(lines, ranges, direction)

const CLOSED_TASK = [
  '[ ] ==> ( ) call Ann',
  '  About the lease.',
  '  Email id: 5678',
  '  [ ] send an email',
]
const OPEN_TASK = ['[x] ==v ( ) done', '  The description.', '  [x] a row', '  [ ] ']

describe('a task', () => {
  it('moves whole, the lines indented under it with it', () => {
    const lines = [...OPEN_TASK, ...CLOSED_TASK, 'at the edge']
    expect(move(lines, [at(4)], UP)).toEqual({ lines: [...CLOSED_TASK, ...OPEN_TASK, 'at the edge'], shifts: [-4] })
    expect(move(lines, [at(0)], DOWN)).toEqual({ lines: [...CLOSED_TASK, ...OPEN_TASK, 'at the edge'], shifts: [4] })
    // A line back at the edge is not the task's: the task steps over it alone.
    expect(move(lines, [at(4)], DOWN)).toEqual({ lines: [...OPEN_TASK, 'at the edge', ...CLOSED_TASK], shifts: [1] })
  })

  it('moves whole when open, once the task line is in the range', () => {
    const lines = ['above', ...OPEN_TASK]
    expect(move(lines, [at(1)], UP).lines).toEqual([...OPEN_TASK, 'above'])
    // A visible line of an open task on its own is a plain line.
    expect(move(lines, [at(2)], UP).lines).toEqual(['above', '  The description.', '[x] ==v ( ) done', '  [x] a row', '  [ ] '])
  })

  it('the last task has nothing below it to step over', () => {
    expect(move(['above', ...CLOSED_TASK], [at(1)], DOWN)).toBeNull()
  })

  it('from a hidden line, moves as its owner', () => {
    const lines = ['above', ...CLOSED_TASK]
    expect(move(lines, [at(3)], UP).lines).toEqual([...CLOSED_TASK, 'above'])
  })
})

describe('a disclosure', () => {
  const closed = ['field -->', '  Type: date', '  Width --v', '    detail']

  it('moves with its body, nested arrows included, when closed', () => {
    expect(move(['x', ...closed, 'y'], [at(1)], UP).lines).toEqual([...closed, 'x', 'y'])
    expect(move(['x', ...closed, 'y'], [at(1)], DOWN).lines).toEqual(['x', 'y', ...closed])
  })

  it('moves alone when open', () => {
    const lines = ['x', 'field --v', '  Type: date']
    expect(move(lines, [at(1)], UP).lines).toEqual(['field --v', 'x', '  Type: date'])
  })

  it('takes every deeper line when closed, however deep', () => {
    const deep = ['field -->', '  Type: date', '  Fields:', '    title --v', '      label: Title']
    expect(move(['x', ...deep, 'y'], [at(1)], UP).lines).toEqual([...deep, 'x', 'y'])
  })

  it('nested inside a task moves with its body', () => {
    const lines = ['[ ] ==v ( ) t', '  desc', '  Email', '  Thread -->', '    id: abc', '  [ ] row']
    expect(move(lines, [at(3)], UP).lines)
      .toEqual(['[ ] ==v ( ) t', '  desc', '  Thread -->', '    id: abc', '  Email', '  [ ] row'])
  })
})

describe('a plain line', () => {
  it('steps into an open disclosure’s body a line at a time, and out again', () => {
    const lines = ['field --v', '  Type: date', 'plain']
    const into = move(lines, [at(2)], UP)
    expect(into).toEqual({ lines: ['field --v', 'plain', '  Type: date'], shifts: [-1] })
    expect(move(into.lines, [at(1)], DOWN).lines).toEqual(lines)
  })

  it('steps over a closed disclosure and its hidden lines as one line, never among them', () => {
    const lines = ['field -->', '  body', '  more', 'plain']
    const up = move(lines, [at(3)], UP)
    expect(up).toEqual({ lines: ['plain', 'field -->', '  body', '  more'], shifts: [-3] })
    expect(move(up.lines, [at(0)], DOWN)).toEqual({ lines, shifts: [3] })
  })

  it('steps over a collapsed task whole', () => {
    const lines = ['plain', ...CLOSED_TASK, '[ ] ==v ( ) next']
    const down = move(lines, [at(0)], DOWN)
    expect(down).toEqual({ lines: [...CLOSED_TASK, 'plain', '[ ] ==v ( ) next'], shifts: [4] })
  })

  it('steps into an expanded task a line at a time', () => {
    const lines = ['plain', '[ ] ==v ( ) t', '  about', '  [ ] row']
    expect(move(lines, [at(0)], DOWN).lines).toEqual(['[ ] ==v ( ) t', 'plain', '  about', '  [ ] row'])
  })
})

describe('neighbours', () => {
  it('an item jumps a whole neighbouring task', () => {
    const task = ['[ ] ==v ( ) other', '  desc', '  [ ] row']
    const lines = [...task, ...CLOSED_TASK]
    expect(move(lines, [at(3)], UP).lines).toEqual([...CLOSED_TASK, ...task])
    expect(move(lines, [at(0)], DOWN).lines).toEqual([...CLOSED_TASK, ...task])
  })

  it('an item jumps a whole closed disclosure', () => {
    const section = ['section -->', '  inner --v', '    deep']
    const lines = [...section, ...CLOSED_TASK]
    expect(move(lines, [at(3)], UP)).toEqual({ lines: [...CLOSED_TASK, ...section], shifts: [-3] })
  })

  it('an item jumps a whole open disclosure, and never lands inside it', () => {
    const section = ['section --v', '  a', '  b --v', '    c']
    const item = ['item -->', '  hidden']
    expect(move([...section, ...item], [at(4)], UP).lines).toEqual([...item, ...section])
    expect(move([...item, ...section], [at(0)], DOWN).lines).toEqual([...section, ...item])
  })

  it('an item inside a section jumps its sibling but not its parent', () => {
    const lines = ['parent --v', '  sibling --v', '    s', '  item -->', '    i']
    const once = move(lines, [at(3)], UP)
    expect(once.lines).toEqual(['parent --v', '  item -->', '    i', '  sibling --v', '    s'])
    expect(move(once.lines, [at(1)], UP).lines).toEqual(['  item -->', '    i', 'parent --v', '  sibling --v', '    s'])
  })

  it('a blank line is a neighbour of its own', () => {
    const lines = ['x', '', ...CLOSED_TASK]
    expect(move(lines, [at(2)], UP).lines).toEqual(['x', ...CLOSED_TASK, ''])
  })
})

describe('selections', () => {
  it('a range holding a closed head takes the whole item', () => {
    const lines = ['x', 'plain', 'field -->', '  body', 'y']
    expect(move(lines, [at(1, 2)], UP)).toEqual({ lines: ['plain', 'field -->', '  body', 'x', 'y'], shifts: [-1] })
  })

  it('several ranges move each on their own, touching ones together', () => {
    const lines = ['a', 'b', 'c', 'd', 'e']
    expect(move(lines, [at(1), at(3)], UP)).toEqual({ lines: ['b', 'a', 'd', 'c', 'e'], shifts: [-1, -1] })
    expect(move(lines, [at(1), at(2)], DOWN)).toEqual({ lines: ['a', 'd', 'b', 'c', 'e'], shifts: [1, 1] })
    expect(move(['x', 'y', 'z', ...CLOSED_TASK], [at(3), at(1)], UP).lines)
      .toEqual(['y', 'x', ...CLOSED_TASK, 'z'])
  })

  it('a range already at the top or bottom stays, the others still move', () => {
    const lines = ['a', 'b', 'c', 'd']
    expect(move(lines, [at(0)], UP)).toBeNull()
    expect(move(lines, [at(3)], DOWN)).toBeNull()
    expect(move([...CLOSED_TASK], [at(0)], DOWN)).toBeNull()
    expect(move(lines, [at(0), at(2)], UP)).toEqual({ lines: ['a', 'c', 'b', 'd'], shifts: [0, -1] })
  })
})
