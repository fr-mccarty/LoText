// Disclosure arrows at the end of any line: a line ending in ` -->` (collapsed) or ` --v`
// (expanded) opens and closes the lines indented deeper under it. As with enhanced tasks, the
// state is the text, so these are pure functions over arrays of lines, tested without an editor.
// `enhanced-view.js` is the CodeMirror side, for these and the task arrows alike. The rule is the
// toolbox's disclosure-arrow spec; `specs/disclosures.md` holds what is LoText's own.
//
// Line numbers are 0-based. An edit is { line, column, char }: one character to replace.

import { parseTaskLine, parseTasks } from './enhanced-tasks.js'

const ARROW_AT_END = /\s(-->|--v)\s*$/
const BLANK = /^\s*$/

/** How many spaces a line starts with. */
export const indentOf = (text) => /^ */.exec(text)[0].length

/**
 * The arrow ending a line, or null: { column, open, indent }, with `column` at the first `-`.
 * It follows whitespace, and trailing spaces are allowed. A line with `<!--` before its arrow is
 * an HTML comment, not a disclosure.
 */
export function parseArrow (text) {
  const match = ARROW_AT_END.exec(text)
  if (!match) return null
  const column = match.index + 1
  if (text.slice(0, column).includes('<!--')) return null
  return { column, open: match[1] === '--v', indent: indentOf(text) }
}

/** The enhanced-task lines: never disclosures, whatever they end in, and the end of any body. */
export function reservedLines (lines, tasks = parseTasks(lines)) {
  return new Set(tasks.map((task) => task.line))
}

/**
 * Every disclosure in `lines`, top to bottom, nested ones included:
 *
 *   { line, column, open, indent, body: [first, last] | null, children: [disclosure], lastLine }
 *
 * The body is every line straight under the arrow's line indented deeper than it, however much
 * deeper; a body line ending in an arrow is a nested disclosure with a body of its own. One blank
 * line with a deeper line after it belongs to the body; two blank lines in a row, a blank line at
 * its end, a reserved line (`skip`), or a line no deeper than the arrow's line ends it. A
 * disclosure with no body is still one.
 */
export function parseDisclosures (lines, { skip = new Set() } = {}) {
  const all = []
  const arrowAt = (index) => skip.has(index) ? null : parseArrow(lines[index])

  const build = (index, arrow) => {
    const disclosure = { line: index, ...arrow, body: bodyUnder(lines, index, { skip }), children: [], lastLine: index }
    all.push(disclosure)
    if (!disclosure.body) return disclosure
    disclosure.lastLine = disclosure.body[1]
    let next = disclosure.body[0]
    while (next <= disclosure.body[1]) {
      const nested = arrowAt(next)
      if (nested) {
        const child = build(next, nested)
        disclosure.children.push(child)
        next = child.lastLine + 1
      } else {
        next++
      }
    }
    return disclosure
  }

  let index = 0
  while (index < lines.length) {
    const arrow = arrowAt(index)
    index = arrow ? build(index, arrow).lastLine + 1 : index + 1
  }
  return all
}

/**
 * The lines indented deeper straight under line `index`, as [first, last], or null: a
 * disclosure's body by the rule above, whether or not the line ends in an arrow. Hide Lines hides
 * them under a line with no arrow.
 */
export function bodyUnder (lines, index, { skip = new Set() } = {}) {
  const indent = indentOf(lines[index])
  const deeper = (at) => at < lines.length && !skip.has(at) && !BLANK.test(lines[at]) && indentOf(lines[at]) > indent
  let next = index + 1
  while (deeper(next) || (next < lines.length && BLANK.test(lines[next]) && deeper(next + 1))) next++
  return next > index + 1 ? [index + 1, next - 1] : null
}

/** The lines a closed disclosure hides, as for a task: [{ first, last }], or none. */
export function hiddenLines (disclosure) {
  if (disclosure.open || !disclosure.body) return []
  return [{ first: disclosure.body[0], last: disclosure.body[1] }]
}

/** What a click on the arrow changes: its third character, `>` ↔ `v`. */
export function arrowFlip (disclosure) {
  return { line: disclosure.line, column: disclosure.column + 2, char: disclosure.open ? '>' : 'v' }
}

// MARK: - Typed arrows open

/**
 * Where an arrow could be on a line, by its text alone: a task's `==>` and a disclosure arrow at
 * the end. Columns of the first character, as { column, open }. Used to tell which arrows an
 * edit found already there.
 */
export function arrowsOnLine (text) {
  const out = []
  const task = parseTaskLine(text)
  if (task) out.push({ column: task.arrowColumn, open: task.open })
  const end = parseArrow(text)
  if (end) out.push({ column: end.column, open: end.open })
  return out
}

/**
 * Every arrow the editor draws, task arrows and disclosure arrows, as { line, column, open }, in
 * no particular order.
 */
export function liveArrows (lines) {
  const tasks = parseTasks(lines)
  const out = []
  for (const task of tasks) out.push({ line: task.line, column: task.arrowColumn, open: task.open })
  for (const disclosure of parseDisclosures(lines, { skip: reservedLines(lines, tasks) })) {
    out.push({ line: disclosure.line, column: disclosure.column, open: disclosure.open })
  }
  return out
}

/**
 * The edits that open the closed arrows among `arrows` that `existed` does not know: an arrow
 * the user has just typed or pasted is written open, `--v` or `==v`, so what it closes is never hidden
 * the moment it appears. `existed(arrow)` answers whether the arrow was there before the edit.
 */
export function openingEdits (arrows, existed) {
  return arrows.filter((arrow) => !arrow.open && !existed(arrow))
    .map((arrow) => ({ line: arrow.line, column: arrow.column + 2, char: 'v' }))
}
