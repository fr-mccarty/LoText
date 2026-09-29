// The range arithmetic behind ⌘D and ⌘X, kept apart from the editor because none of it needs
// one: every function here is a pure answer about a string and some ranges. That is also what
// makes it cheap to check — the same questions can be asked of a plain string with no view,
// no layout and no focus in the way.
//
// A range is `{ location, length }` over the string's own code units, which is what an editor
// selection is.

// Foundation's `CharacterSet.alphanumerics` plus `_`, which is what Lolext calls a word. That set
// is letters, marks and numbers — marks included, so a decomposed `é` or a Devanagari vowel sign
// stays inside the word it belongs to.
const WORD = /[\p{L}\p{M}\p{N}_]/u

/**
 * Foundation's `CharacterSet.whitespacesAndNewlines`, which is what Lolext trims a line by. Not
 * JavaScript's `\s`: that also takes U+FEFF, and misses U+0085 and the zero-width space U+200B.
 */
export const WHITESPACE = /[\p{Z}\t-\r\u0085\u200b]/u

export function range (location, length = 0) {
  return { location, length }
}

export function maxRange (target) {
  return target.location + target.length
}

/** The run of word characters around `location`, or null if there is none touching it. */
export function wordAt (location, text) {
  const isWord = (index) => index >= 0 && index < text.length && WORD.test(text[index])
  let start = Math.min(location, text.length)
  // A caret just past the end of a word belongs to that word, which is what double-click and
  // every other editor's ⌘D do.
  while (start > 0 && isWord(start - 1)) start -= 1
  let end = start
  while (isWord(end)) end += 1
  return end > start ? range(start, end - start) : null
}

/**
 * The next occurrence of `needle` starting after `location`, wrapping to the top of the file
 * so the last occurrence is not a dead end. Null when the text does not appear at all.
 */
export function occurrenceOf (needle, after, text) {
  if (!needle) return null
  const from = Math.min(after, text.length)
  const ahead = text.indexOf(needle, from)
  if (ahead >= 0) return range(ahead, needle.length)
  const wrapped = text.indexOf(needle)
  return wrapped >= 0 ? range(wrapped, needle.length) : null
}

/** The whole line containing `location`, including the newline that ends it. */
export function lineRange (location, text) {
  const at = Math.min(Math.max(0, location), text.length)
  // Not `lastIndexOf('\n', -1)` on the first line: a negative start is read as 0, so a file
  // opening with a blank line would find that newline and put line one after it.
  const start = at > 0 ? text.lastIndexOf('\n', at - 1) + 1 : 0
  const newline = text.indexOf('\n', at)
  const end = newline < 0 ? text.length : newline + 1
  return range(start, end - start)
}

/**
 * One entry per distinct line the given positions touch, each including its newline, in file
 * order. Two carets on one line produce one entry.
 */
export function linesTouchedBy (positions, text) {
  const lines = []
  for (const position of positions) {
    const line = lineRange(position.location, text)
    const last = lines[lines.length - 1]
    if (!last || last.location !== line.location || last.length !== line.length) lines.push(line)
  }
  return lines
}

/**
 * What to actually delete in order to cut those lines.
 *
 * Deleting the last line of a file that has no trailing newline would leave the line above it
 * ending in one, i.e. a blank line where the cut line used to be. Eat the newline in front of
 * it instead.
 */
export function deletionsForLines (lines, text) {
  const last = lines[lines.length - 1]
  if (!last || maxRange(last) !== text.length || last.length === 0 ||
      text.slice(last.location, maxRange(last)).endsWith('\n') || last.location === 0) {
    return lines
  }
  return [...lines.slice(0, -1), range(last.location - 1, last.length + 1)]
}

/**
 * The one edit that moves the lines under `positions` up (`offset` −1) or down (+1) past their
 * neighbour, as the range to replace, the text to put there, and how far the selection travels.
 * Null at the ends of the file, where there is no neighbour to trade places with.
 *
 * Every line the selection touches moves, whole, however little of it is selected — and the
 * lines in between come along, so a block stays a block. Both chunks are split into content and
 * line terminator, then recombined content-first, so that a last line with no newline of its own
 * does not drag a missing newline around with it: moving `b` up in `"a\nb"` gives `"b\na"`.
 */
export function lineMove (positions, offset, text) {
  if (!offset || !positions.length) return null
  const start = Math.min(...positions.map((position) => position.location))
  const end = Math.max(...positions.map(maxRange))

  const first = lineRange(Math.min(start, text.length), text)
  // A selection stopping exactly at the start of a line has not reached into that line, so the
  // line it ends on is the one holding the last selected character.
  const last = lineRange(Math.min(end > start ? end - 1 : end, text.length), text)
  const block = union(first, last)
  // The empty position after a file's final newline is not a line and has nothing to trade:
  // moving it would invent a newline rather than reorder one.
  if (block.length === 0 && maxRange(block) >= text.length) return null

  let neighbour
  if (offset < 0) {
    if (block.location === 0) return null
    neighbour = lineRange(block.location - 1, text)
  } else {
    if (maxRange(block) >= text.length) return null
    neighbour = lineRange(maxRange(block), text)
  }

  const split = (target) => {
    const chunk = text.slice(target.location, maxRange(target))
    return chunk.endsWith('\n')
      ? { content: chunk.slice(0, -1), hasNewline: true }
      : { content: chunk, hasNewline: false }
  }
  const moving = split(block)
  const passed = split(neighbour)
  const whole = union(block, neighbour)
  // The union's own ending is kept: only what is inside it changes places.
  const tail = split(whole).hasNewline ? '\n' : ''
  const replacement = offset < 0
    ? `${moving.content}\n${passed.content}${tail}`
    : `${passed.content}\n${moving.content}${tail}`
  const shift = offset < 0 ? -neighbour.length : passed.content.length + 1
  return { range: whole, replacement, shift }
}

export function union (a, b) {
  const location = Math.min(a.location, b.location)
  return range(location, Math.max(maxRange(a), maxRange(b)) - location)
}

/**
 * Where the carets end up once every one of `targets` has been replaced by a string of
 * `insertedLength` characters. Each earlier replacement shifts everything after it.
 */
export function caretsAfterReplacing (targets, insertedLength) {
  let shift = 0
  const carets = []
  for (const target of targets) {
    carets.push(range(target.location + shift + insertedLength, 0))
    shift += insertedLength - target.length
  }
  return carets
}

/**
 * Ascending, non-overlapping, non-touching — which is what a multi-site edit needs in order to
 * rewrite back-to-front safely. ⌘D on a word that appears twice in a row, or two carets on one
 * line, can produce ranges that touch.
 */
export function merged (input) {
  const sorted = [...input].sort((a, b) => a.location - b.location)
  const out = []
  for (const item of sorted) {
    const last = out[out.length - 1]
    if (last && maxRange(last) >= item.location && (last.length > 0 || item.length > 0)) {
      out[out.length - 1] = union(last, item)
    } else if (last && last.location === item.location && last.length === item.length) {
      continue                                // two carets in the same place are one caret
    } else {
      out.push(range(item.location, item.length))
    }
  }
  return out
}
