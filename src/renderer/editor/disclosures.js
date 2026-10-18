// Disclosure arrows anywhere on a line: the first `-->` or `==>` (collapsed), `--v` or `==v`
// (expanded) on a line opens and closes the lines indented deeper under it. As with enhanced
// tasks, the state is the text, so these are pure functions over arrays of lines, tested without an editor.
// `enhanced-view.js` is the CodeMirror side, for these and the task arrows alike. The rule is
// jam-spec's disclosure-arrow spec; `specs/disclosures.md` holds what is LoText's own.
//
// Line numbers are 0-based. An edit is { line, column, char }: one character to replace.

import { parseTaskLine, parseTasks } from './enhanced-tasks.js'
import { bodyUnder, indentOf } from './indented-body.js'

export { bodyUnder, indentOf }

const ARROW = /(^|\s)(-->|--v|==>|==v)(?=\s|$)/
/**
 * The first arrow on a line, or null: { column, open, indent }, with `column` at its first `-` or
 * `=`. It starts the line or follows whitespace, and is followed by whitespace or the end of the
 * line, so `a --> b` and `--> b` have one and `text-->`, `--verbose` do not. A line with `<!--`
 * before its arrow is an HTML comment, and an arrow alone in the first column, as `-->` ends a
 * longer comment, is plain text too.
 */
export function parseArrow (text) {
  const match = ARROW.exec(text)
  if (!match) return null
  const column = match.index + match[1].length
  if (text.slice(0, column).includes('<!--')) return null
  if (column === 0 && !text.slice(3).trim()) return null
  return { column, open: match[2].endsWith('v'), indent: indentOf(text) }
}

/** The enhanced-task lines: never disclosures, whatever they end in. */
export function reservedLines (lines, tasks = parseTasks(lines)) {
  return new Set(tasks.map((task) => task.line))
}

/**
 * Every disclosure in `lines`, top to bottom, nested ones included:
 *
 *   { line, column, open, indent, body: [first, last] | null, children: [disclosure], lastLine }
 *
 * The body is every line straight under the arrow's line indented deeper than it, however much
 * deeper; a body line with an arrow is a nested disclosure with a body of its own. One blank
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
 * Where the arrow is on a line, by its text alone: a task line's `==>`, or the line's first
 * disclosure arrow. The column of its first character, as [{ column, open }], or none. Used to
 * tell which arrows an edit found already there.
 */
export function arrowsOnLine (text) {
  const task = parseTaskLine(text)
  if (task) return [{ column: task.arrowColumn, open: task.open }]
  const arrow = parseArrow(text)
  return arrow ? [{ column: arrow.column, open: arrow.open }] : []
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
