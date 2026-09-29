// A long line that starts with spaces or tabs wraps onto rows indented as far as its own text,
// not back to the left edge. This is only how it is drawn; no spaces are added to the text.

import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, ViewPlugin } from '@codemirror/view'

/**
 * How many columns the leading spaces and tabs of `text` take, a tab reaching the next multiple
 * of `tabSize`. The editor fonts are all monospaced, so a column is one `ch`.
 */
export function indentColumns (text, tabSize) {
  let columns = 0
  for (const char of text) {
    if (char === ' ') columns++
    else if (char === '\t') columns += tabSize - (columns % tabSize)
    else break
  }
  return columns
}

const hanging = new Map()
const hangingLine = (columns) => {
  if (!hanging.has(columns)) {
    hanging.set(columns, Decoration.line({
      attributes: { style: `padding-left: ${columns}ch !important; text-indent: -${columns}ch` },
    }))
  }
  return hanging.get(columns)
}

/**
 * Chromium measures tab stops from where the negative `text-indent` puts the line's first row, so
 * a leading tab would reach one stop too far. Leading whitespace holding a tab is set in a block
 * of its own, whose tab stops start at its left edge.
 */
const leads = new Map()
const tabbedLead = (columns) => {
  if (!leads.has(columns)) {
    leads.set(columns, Decoration.mark({
      attributes: { style: `display: inline-block; text-indent: 0; width: ${columns}ch` },
    }))
  }
  return leads.get(columns)
}

function decorationsFor (view) {
  const { state } = view
  const builder = new RangeSetBuilder()
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos)
      const columns = indentColumns(line.text, state.tabSize)
      if (columns) {
        builder.add(line.from, line.from, hangingLine(columns))
        const lead = /^[ \t]*/.exec(line.text)[0]
        if (lead.includes('\t')) builder.add(line.from, line.from + lead.length, tabbedLead(columns))
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

export const hangingIndent = ViewPlugin.fromClass(class {
  constructor (view) {
    this.decorations = decorationsFor(view)
  }

  update (update) {
    if (update.docChanged || update.viewportChanged) this.decorations = decorationsFor(update.view)
  }
}, { decorations: (plugin) => plugin.decorations })
