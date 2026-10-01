// The lines indented deeper under a line: what a disclosure arrow, an enhanced task and Hide Lines
// all hide. Its own module so both `enhanced-tasks.js` and `disclosures.js` can use it.

const BLANK = /^\s*$/

/** How many spaces a line starts with. */
export const indentOf = (text) => /^ */.exec(text)[0].length

/**
 * The lines indented deeper straight under line `index`, as [first, last], or null. One blank
 * line with a deeper line after it belongs to them; two blank lines in a row, a blank line at the
 * end, a line in `skip`, or a line no deeper than line `index` ends them.
 */
export function bodyUnder (lines, index, { skip = new Set() } = {}) {
  const indent = indentOf(lines[index])
  const deeper = (at) => at < lines.length && !skip.has(at) && !BLANK.test(lines[at]) && indentOf(lines[at]) > indent
  let next = index + 1
  while (deeper(next) || (next < lines.length && BLANK.test(lines[next]) && deeper(next + 1))) next++
  return next > index + 1 ? [index + 1, next - 1] : null
}
