// Pipe tables. A table is the one block the printer reshapes rather than reproduces: the
// pipes and dashes are scaffolding for a grid, and printing them would be printing the
// scaffolding instead of the thing it holds up.
//
//     | Item   | Qty | Price |
//     |--------|:---:|------:|
//     | Pencil |  2  | 1.50  |
//
// The header row and the dashed row beneath it are both required. A line with pipes in it and
// no dashed row under it is not a table — it is a line with pipes in it, and it prints as one.

import { parseInline, span } from './inline.js'

/**
 * A table starting at `index`, and the line to carry on from. Null when what is there is not
 * a table, which leaves the caller to treat the line as ordinary text.
 */
export function parseTable (all, index, { isBlank, heading }) {
  if (index + 1 >= all.length) return null
  if (!all[index].includes('|')) return null
  const alignments = alignmentRow(all[index + 1])
  if (!alignments) return null

  // One column is still a table. The dashed row is what settles it: a line whose every cell
  // is nothing but dashes, fenced by pipes, is not prose in any other reading.
  const header = cells(all[index])
  const width = Math.max(header.length, alignments.length)
  const rows = []
  let next = index + 2

  // Rows run until a blank line, a heading, or a line with no pipe in it — any of which is
  // plainly the end of the table rather than a ragged row of it.
  while (next < all.length) {
    const line = all[next]
    if (isBlank(line) || !line.includes('|') || heading(line)) break
    rows.push(padded(cells(line), width, () => [span('')]))
    next += 1
  }

  return {
    table: {
      header: padded(header, width, () => [span('')]),
      alignments: padded(alignments, width, () => 'leading'),
      rows,
      columnCount: width,
    },
    next,
  }
}

/**
 * `|---|:--:|---:|` — the row that makes the lines above and below it a table, and the only
 * place column alignment is stated. Every cell in it must be dashes, optionally fenced by
 * colons; anything else and this is not a table.
 */
function alignmentRow (line) {
  if (line === undefined || !line.includes('|') || !line.includes('-')) return null
  const parts = splitCells(line)
  if (!parts.length) return null

  const alignments = []
  for (const part of parts) {
    const trimmed = part.trim()
    const leading = trimmed.startsWith(':')
    const trailing = trimmed.endsWith(':')
    const dashes = trimmed.slice(leading ? 1 : 0, trimmed.length - (trailing ? 1 : 0))
    if (!dashes.length || !/^-+$/.test(dashes)) return null
    alignments.push(leading && trailing ? 'center' : (trailing ? 'trailing' : 'leading'))
  }
  return alignments
}

/** One row's cells, each parsed for inline style. */
function cells (line) {
  return splitCells(line).map((cell) => parseInline(cell.trim()))
}

/**
 * Splits on unescaped pipes, dropping the optional pipe at each end of the row. `\|` is a
 * literal pipe in a cell and does not split it.
 */
function splitCells (line) {
  const parts = []
  let current = ''
  let characters = Array.from(line)
  let index = 0

  // A leading or trailing pipe is a fence, not an empty cell — unless the trailing one was
  // escaped, in which case it is a pipe the author asked for and the row has no closing fence.
  if (characters[0] === '|') characters = characters.slice(1)
  if (characters[characters.length - 1] === '|' && characters.length > 1 &&
      !isEscaped(characters.length - 1, characters)) {
    characters = characters.slice(0, -1)
  }

  while (index < characters.length) {
    const character = characters[index]
    if (character === '\\' && characters[index + 1] === '|') {
      current += '|'
      index += 2
      continue
    }
    if (character === '|') {
      parts.push(current)
      current = ''
      index += 1
      continue
    }
    current += character
    index += 1
  }
  parts.push(current)
  return parts
}

/**
 * Whether the character at `index` is escaped: preceded by an odd number of backslashes, so
 * that `\|` is an escaped pipe but `\\|` is a backslash and then a fence.
 */
function isEscaped (index, characters) {
  let backslashes = 0
  let scan = index - 1
  while (scan >= 0 && characters[scan] === '\\') { backslashes += 1; scan -= 1 }
  return backslashes % 2 === 1
}

/** A short row is padded rather than dropped: a table missing a cell still prints. */
function padded (row, width, fill) {
  if (row.length >= width) return row.slice(0, width)
  return row.concat(Array.from({ length: width - row.length }, fill))
}
