// Editing by whole lines: ⌘X with nothing selected, Tab and ⇧Tab, and Return. The app's editor binds
// them (editor.js) and so does the editor on the LoText web page (src/web/playground.js), which
// is why they live apart from the rest of the editor.

import { EditorSelection } from '@codemirror/state'
import * as TextRanges from './text-ranges.js'

/**
 * ⌘X with only carets: every line a caret is on goes to the clipboard and out of the buffer, as
 * `Editor.cut` in editor.js describes. False, doing nothing, when anything is selected, so the ordinary cut
 * runs instead. The lines leave once the clipboard has them, and not if it refuses them.
 */
export function cutWholeLines (view) {
  const state = view.state
  if (!state.selection.ranges.every((range) => range.empty)) return false
  const text = state.doc.toString()
  const sites = state.selection.ranges
    .map((range) => TextRanges.range(range.from, 0))
    .sort((a, b) => a.location - b.location)
  const lines = TextRanges.merged(TextRanges.linesTouchedBy(sites, text))
  if (!lines.length) return true

  const payload = lines.map((line) => {
    const chunk = text.slice(line.location, TextRanges.maxRange(line))
    return chunk.endsWith('\n') ? chunk : `${chunk}\n`
  }).join('')
  const changes = TextRanges.deletionsForLines(lines, text).map((target) => ({
    from: target.location, to: TextRanges.maxRange(target), insert: '',
  }))
  navigator.clipboard.writeText(payload).then(() => {
    if (view.state.doc === state.doc) view.dispatch({ changes, userEvent: 'delete.cut' })
  }, () => {})
  return true
}

/**
 * Tab: with nothing selected, `count` spaces at every caret; with a selection, `count` more at
 * the head of every line it touches.
 */
export function indentBy (view, count) {
  const spaces = ' '.repeat(count)
  const state = view.state
  if (state.selection.ranges.every((range) => range.empty)) {
    view.dispatch(state.replaceSelection(spaces), { scrollIntoView: true, userEvent: 'input.indent' })
    return true
  }
  view.dispatch({
    changes: linesOfSelection(state).map((line) => ({ from: line.from, insert: spaces })),
    userEvent: 'input.indent',
  })
  return true
}

/** ⇧Tab: up to `count` leading spaces off every line the selection touches. */
export function outdentBy (view, count) {
  const changes = []
  for (const line of linesOfSelection(view.state)) {
    const leading = /^ */.exec(line.text)[0].length
    if (leading) changes.push({ from: line.from, to: line.from + Math.min(leading, count) })
  }
  if (changes.length) view.dispatch({ changes, userEvent: 'delete.dedent' })
  return true
}

/**
 * Return: a new line starting as deep as the one the caret was on — its leading spaces and tabs,
 * character for character, so tabs stay tabs. CodeMirror's own Return measured the indent and
 * wrote it back as spaces. A caret inside the indent takes only the part before it. A line that
 * is nothing but indent up to the caret gives its indent to the new line rather than keeping it
 * as trailing whitespace, so Return twice leaves a truly blank line. Lolext's Return indents
 * nothing; this was asked for.
 */
export function insertNewlineKeepingIndent (view) {
  const state = view.state
  view.dispatch(state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from)
    const before = line.text.slice(0, range.from - line.from)
    const indent = /^[ \t]*/.exec(before)[0]
    const from = indent.length === before.length ? line.from : range.from
    const insert = `\n${indent}`
    return {
      changes: { from, to: range.to, insert },
      range: EditorSelection.cursor(from + insert.length),
    }
  }), { scrollIntoView: true, userEvent: 'input' })
  return true
}

export function linesOfSelection (state) {
  const lines = new Map()
  for (const range of state.selection.ranges) {
    // A selection ending at the very start of a line does not take that line with it.
    const end = range.to > range.from && state.doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to
    for (let pos = range.from; pos <= end;) {
      const line = state.doc.lineAt(pos)
      lines.set(line.number, line)
      pos = line.to + 1
    }
  }
  return [...lines.values()]
}
