// Enhanced tasks: a `[[ ]] ==> (()) title` line and the lines indented under it.
// Everything is plain text, and whether a task is open is written in the text itself (`==>`
// collapsed, `==v` expanded), so the parts here are pure functions over arrays of lines, tested
// without an editor. `enhanced-view.js` is the CodeMirror side. The rules are the toolbox's
// enhanced-task and enhanced-selection specs; `specs/enhanced-tasks.md` holds what is LoText's own.
//
// Line numbers are 0-based. An edit is { line, column, char }: one character to replace.

import { bodyUnder } from './indented-body.js'

const TASK = /^\[\[([ xX])\]\] (==>|==v) \(\((.*?)\)\)(?: (.*))?$/
const CHOICE = /^ {2}\[([ xX])\](?: (.*))?$/

/** Where the task arrow's first `=` is on a task line: after `[[ ]] `. */
const TASK_ARROW_COLUMN = 6

/** Where the box's middle character is on a choice: `  [x]`. */
const CHOICE_BOX_COLUMN = 3

/**
 * A task line's parts, or null: `[[x]] ==v ((ring first)) Call Ann` → { checked: true,
 * open: true, arrowColumn: 6, feedback: 'ring first', title: 'Call Ann' }. The title may be empty
 * while it is typed. A plain `[ ] Call Ann` is not a task line.
 */
export function parseTaskLine (text) {
  const match = TASK.exec(text)
  if (!match) return null
  return {
    checked: match[1] !== ' ',
    open: match[2] === '==v',
    arrowColumn: TASK_ARROW_COLUMN,
    feedback: match[3],
    title: (match[4] ?? '').trim(),
  }
}

/** A choice of an enhanced selection, or null: `  [x] send a text` → { checked: true, label: 'send a text' }. */
export function parseChoice (text) {
  const match = CHOICE.exec(text)
  if (!match) return null
  return { checked: match[1] !== ' ', label: (match[2] ?? '').trim() }
}

/**
 * Every enhanced task in `lines`, top to bottom:
 *
 *   { line, checked, open, arrowColumn, feedback, title,
 *     body: [first, last] | null,
 *     choices: [{ line, checked, label }],
 *     lastLine }
 *
 * A task owns the lines indented deeper straight under it, as a disclosure arrow's line does
 * (`bodyUnder`): the first line back at column 0, or two blank lines in a row, ends it. `body` is
 * those lines, inclusive; `choices` are the enhanced-selection rows among them.
 */
export function parseTasks (lines) {
  const heads = []
  lines.forEach((text, line) => {
    const head = parseTaskLine(text)
    if (head) heads.push({ line, ...head })
  })
  return heads.map((head) => {
    const body = bodyUnder(lines, head.line)
    const lastLine = body ? body[1] : head.line
    const choices = []
    for (let line = head.line + 1; line <= lastLine; line++) {
      const choice = parseChoice(lines[line])
      if (choice) choices.push({ line, ...choice })
    }
    return { ...head, body, choices, lastLine }
  })
}

/** The task whose lines (task line to last line) include `lineIndex`, or null. */
export function taskAt (tasks, lineIndex) {
  return tasks.find((task) => task.line <= lineIndex && lineIndex <= task.lastLine) ?? null
}

/** The lines a collapsed task hides, as inclusive ranges [{ first, last }]: its whole body. */
export function hiddenLines (task) {
  if (task.open || !task.body) return []
  return [{ first: task.body[0], last: task.body[1] }]
}

// MARK: - Clicking

/** What a click on the task arrow changes: its third character, `>` ↔ `v`. */
export function arrowFlip (task) {
  return { line: task.line, column: task.arrowColumn + 2, char: task.open ? '>' : 'v' }
}

/**
 * The edits that collapse a task whose box has just been checked: its arrow, when expanded.
 * Unchecking changes no arrow.
 */
export function checkEdits (task) {
  return task.open ? [arrowFlip(task)] : []
}

// MARK: - Typing into an empty choice

/**
 * Called after an edit changed line `lineIndex`, which was an empty choice (`  [ ] `) before it.
 * If the line is a choice under an enhanced task, is unchecked and now has a label, the answer is
 * the edit that checks it. Otherwise null.
 */
export function emptyChoiceEdit (lines, lineIndex) {
  const task = taskAt(parseTasks(lines), lineIndex)
  const choice = task?.choices.find((candidate) => candidate.line === lineIndex)
  if (!choice || choice.checked || !choice.label) return null
  return { line: lineIndex, column: CHOICE_BOX_COLUMN, char: 'x' }
}
