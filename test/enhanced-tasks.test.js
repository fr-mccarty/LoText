import { describe, it, expect } from 'vitest'
import {
  parseTasks, parseTaskLine, parseChoice, taskAt, hiddenLines, arrowFlip, checkEdits, emptyChoiceEdit,
} from '../src/renderer/editor/enhanced-tasks.js'

// The examples from jam-spec's enhanced-task and enhanced-selection specs.
const DESCRIPTION = '  This is the description. It could have labels, or be a paragraph.'
const EXPANDED = [
  '[ ] ==v ( ) This is an enhanced task',
  DESCRIPTION,
  '  Email id: 5678987656789',
  '  [ ] send an email',
  '  [ ] send a text',
]
const COLLAPSED = ['[ ] ==> ( ) This is an enhanced task', ...EXPANDED.slice(1)]

const only = (lines) => {
  const tasks = parseTasks(lines)
  expect(tasks).toHaveLength(1)
  return tasks[0]
}
const apply = (lines, edits) => {
  const out = [...lines]
  for (const { line, column, char } of edits) out[line] = out[line].slice(0, column) + char + out[line].slice(column + 1)
  return out
}

describe('the task line', () => {
  it('reads the box, the arrow, the feedback slot and the title', () => {
    expect(parseTaskLine('[ ] ==> ( ) This is an enhanced task')).toEqual({
      checked: false, open: false, arrowColumn: 4, feedback: '', title: 'This is an enhanced task',
    })
    expect(parseTaskLine('[x] ==v (And type something to your agent.) Call Ann')).toEqual({
      checked: true, open: true, arrowColumn: 4, feedback: 'And type something to your agent.', title: 'Call Ann',
    })
    expect(parseTaskLine('[X] ==> ( )')).toMatchObject({ checked: true, title: '' })
  })

  it('is not a plain box, a disclosure arrow, or an indented line', () => {
    expect(parseTaskLine('[ ] do something')).toBeNull()
    expect(parseTaskLine('[ ] --> do something')).toBeNull()
    expect(parseTaskLine('[ ] --> ( ) single arrow')).toBeNull()
    expect(parseTaskLine('[ ] ==> no feedback slot')).toBeNull()
    expect(parseTaskLine('  [ ] ==> ( ) indented')).toBeNull()
    expect(parseTaskLine('[ ]==> ( ) no space')).toBeNull()
  })
})

describe('the choices of an enhanced selection', () => {
  it('reads a choice indented two spaces', () => {
    expect(parseChoice('  [x] send a text')).toEqual({ checked: true, label: 'send a text' })
    expect(parseChoice('  [ ] ')).toEqual({ checked: false, label: '' })
    expect(parseChoice('[ ] send')).toBeNull()
    expect(parseChoice('  [ ]send')).toBeNull()
  })

  it('collects the choices under a task', () => {
    expect(only(EXPANDED).choices).toEqual([
      { line: 3, checked: false, label: 'send an email' },
      { line: 4, checked: false, label: 'send a text' },
    ])
  })
})

describe('what a task owns', () => {
  it('owns every line down to the end of the document', () => {
    expect(only(EXPANDED)).toMatchObject({ line: 0, body: [1, 4], lastLine: 4 })
  })

  it('owns the lines indented under it, as a disclosure arrow does', () => {
    const lines = [
      '[ ] ==> ( ) first',
      '  description',
      '',
      '    deeper',
      'a line at the edge',
      '  indented, but under the edge line',
      '[x] ==v ( ) second',
      '  its description',
      '',
      '',
      '  after two blank lines',
    ]
    const tasks = parseTasks(lines)
    expect(tasks.map((task) => [task.line, task.body, task.lastLine])).toEqual([[0, [1, 3], 3], [6, [7, 7], 7]])
    expect(taskAt(tasks, 2).line).toBe(0)
    expect(taskAt(tasks, 4)).toBe(null)
    expect(taskAt(tasks, 5)).toBe(null)
    expect(taskAt(tasks, 7).line).toBe(6)
    expect(taskAt(tasks, 10)).toBe(null)
  })

  it('owns nothing when the next line is a task line, or there is none', () => {
    const tasks = parseTasks(['[ ] ==> ( ) a', '[ ] ==> ( ) b'])
    expect(tasks.map((task) => [task.body, task.lastLine])).toEqual([[null, 0], [null, 1]])
    expect(hiddenLines(tasks[0])).toEqual([])
  })

  it('leaves lines above the first task alone', () => {
    const tasks = parseTasks(['notes', '[ ] milk', '[ ] ==> ( ) T', '  d'])
    expect(tasks).toHaveLength(1)
    expect(taskAt(tasks, 1)).toBeNull()
  })
})

describe('what is hidden', () => {
  it('a collapsed task hides every line it owns', () => {
    expect(hiddenLines(only(COLLAPSED))).toEqual([{ first: 1, last: 4 }])
  })

  it('an expanded task hides nothing', () => {
    expect(hiddenLines(only(EXPANDED))).toEqual([])
  })

  it('a collapsed task hides its indented lines and no further', () => {
    const tasks = parseTasks(['[ ] ==> ( ) a', '  one', 'two', '[ ] ==v ( ) b', '  three'])
    expect(tasks.map(hiddenLines)).toEqual([[{ first: 1, last: 1 }], []])
  })
})

describe('clicking and checking', () => {
  it('a click flips the third character of the arrow', () => {
    expect(arrowFlip(only(COLLAPSED))).toEqual({ line: 0, column: 6, char: 'v' })
    expect(apply(EXPANDED, [arrowFlip(only(EXPANDED))])[0]).toBe(COLLAPSED[0])
  })

  it('checking an expanded task collapses it', () => {
    expect(checkEdits(only(EXPANDED))).toEqual([{ line: 0, column: 6, char: '>' }])
  })

  it('checking a collapsed task has nothing to collapse', () => {
    expect(checkEdits(only(COLLAPSED))).toEqual([])
  })
})

describe('typing into an empty choice', () => {
  it('checks the choice once it has text', () => {
    const lines = [...EXPANDED, '  [ ] c']
    expect(emptyChoiceEdit(lines, 5)).toEqual({ line: 5, column: 3, char: 'x' })
  })

  it('leaves an empty, checked, or outside choice alone', () => {
    expect(emptyChoiceEdit([...EXPANDED, '  [ ] '], 5)).toBeNull()
    expect(emptyChoiceEdit(['[ ] ==v ( ) T', '  [x] a'], 1)).toBeNull()
    expect(emptyChoiceEdit(['[ ] plain', '  [ ] a'], 1)).toBeNull()
  })
})
