// The printed document as a list of blocks. This is the *only* markdown knowledge in the app,
// and it exists only on the print path — nothing here ever reaches the screen.
//
// A block is a run of consecutive non-blank lines. Blank lines are separators and are never
// emitted as content, so a file whose every line is a short sentence does not print
// double-spaced. A heading is always its own block, and so is a table.

import { parseInline } from './inline.js'
import { parseTable } from './table.js'

export { BOLD, ITALIC, CODE, parseInline } from './inline.js'

/**
 * Splits on any newline. CRLF, LF and a lone CR all behave the same, so no stray `\r`
 * survives into a line.
 */
export function linesOf (text) {
  return text.split(/\r\n|\n|\r/)
}

/** Empty, or nothing but whitespace: there is no content to print either way. */
export function isBlank (line) {
  return line.trim().length === 0
}

/**
 * One to six leading `#` followed by a space. Seven hashes is not a heading, `#hashtag` is
 * not a heading, and neither is a `#` with nothing after it.
 */
export function heading (line) {
  let level = 0
  let index = 0
  while (index < line.length && line[index] === '#') {
    level += 1
    if (level > 6) return null
    index += 1
  }
  if (level < 1 || line[index] !== ' ') return null
  return { level, text: line.slice(index + 1) }
}

/** The whole document, as `{kind:'heading'|'paragraph'|'table'}` blocks. */
export function parseBlocks (text) {
  const blocks = []
  let pending = []
  const all = linesOf(text)
  let index = 0

  const flushPending = () => {
    if (!pending.length) return
    blocks.push({ kind: 'paragraph', lines: pending })
    pending = []
  }

  while (index < all.length) {
    const line = all[index]
    if (isBlank(line)) {
      flushPending()                        // the run of blanks collapses to one break
      index += 1
      continue
    }
    const head = heading(line)
    if (head) {
      flushPending()
      blocks.push({ kind: 'heading', level: head.level, text: parseInline(head.text) })
      index += 1
      continue
    }
    const table = parseTable(all, index, { isBlank, heading })
    if (table) {
      flushPending()
      blocks.push({ kind: 'table', table: table.table })
      index = table.next
      continue
    }
    pending.push(parseInline(line))
    index += 1
  }
  flushPending()
  return blocks
}
