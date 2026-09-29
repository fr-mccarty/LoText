// `**bold**`, `*italic*`, `***both***` and `` `code` ``, turned into styled runs. Part of the
// printer, like the rest of the markdown knowledge in this app: the editor never sees any of
// it, and a file that uses none of these characters prints exactly as it always did.
//
// Deliberately a small dialect rather than a markdown implementation. The rule it holds to is
// that anything it does not recognise is printed literally, character for character — a file
// full of asterisks that mean asterisks must not come out mangled.

export const BOLD = 1
export const ITALIC = 2
export const CODE = 4

/** A run of characters that share one style. */
export function span (text, style = 0) {
  return { text, style }
}

const EMPHASIS_MARKERS = new Set(['*', '_'])
// What a backslash may escape. Everything else keeps its backslash, so a Windows path in a
// note stays a Windows path.
const MARKDOWN_PUNCTUATION = new Set('\\`*_{}[]()#+-.!|~'.split(''))

function isWhitespace (character) {
  return /\s/.test(character)
}

/** Start or end of a word, for the underscore rule. */
function isWordBoundary (character) {
  if (character === undefined) return true
  if (character === '_') return false
  return isWhitespace(character) || /[\p{P}\p{S}]/u.test(character)
}

/**
 * The whole line as styled runs. Never returns an empty array: a blank line is one empty
 * unstyled span, so a caller can always ask a line for its font.
 */
export function parseInline (line) {
  const spans = merge(emphasis(Array.from(line), 0))
  return spans.length ? spans : [span('')]
}

/**
 * Recursive descent over one style level at a time: find the first delimiter run that has a
 * valid partner, keep what came before it as-is, recurse into what it encloses with the extra
 * style, and carry on after it.
 */
function emphasis (characters, style) {
  const spans = []
  let literal = ''
  let index = 0

  while (index < characters.length) {
    const character = characters[index]

    // A backslash makes the next punctuation mark mean itself. This is what lets a file say
    // `2 * 3 \* 4` and print the asterisks.
    if (character === '\\' && index + 1 < characters.length &&
        MARKDOWN_PUNCTUATION.has(characters[index + 1])) {
      literal += characters[index + 1]
      index += 2
      continue
    }

    // Code spans win over emphasis and are never looked inside: `**` inside backticks is two
    // asterisks, because that is what code means.
    if (character === '`') {
      const code = codeSpan(characters, index)
      if (code) {
        if (literal) { spans.push(span(literal, style)); literal = '' }
        spans.push(span(code.text, style | CODE))
        index = code.next
        continue
      }
    }

    if (EMPHASIS_MARKERS.has(character) && !(style & CODE)) {
      const run = emphasisRun(characters, index, style)
      if (run) {
        if (literal) { spans.push(span(literal, style)); literal = '' }
        spans.push(...emphasis(characters.slice(run.start, run.end), style | run.style))
        index = run.next
        continue
      }
    }

    literal += character
    index += 1
  }

  if (literal) spans.push(span(literal, style))
  return spans
}

/**
 * A run of backticks, the text up to the next run of the same length, and where to carry on.
 * An unclosed run is not a code span and is printed as the backticks it is.
 */
function codeSpan (characters, start) {
  const fence = runLength('`', characters, start)
  let index = start + fence
  while (index < characters.length) {
    if (characters[index] !== '`') { index += 1; continue }
    const closing = runLength('`', characters, index)
    if (closing === fence) {
      return { text: characters.slice(start + fence, index).join(''), next: index + closing }
    }
    index += closing
  }
  return null
}

/**
 * The delimiter run at `start`, the range it encloses, and what style it means — or null when
 * it opens nothing, in which case the caller prints the character literally.
 */
function emphasisRun (characters, start, style) {
  const marker = characters[start]
  const length = Math.min(3, runLength(marker, characters, start))
  const contentStart = start + length
  if (contentStart >= characters.length) return null

  // A run only opens when something non-blank follows it: `2 * 3` is arithmetic.
  if (isWhitespace(characters[contentStart])) return null
  // Underscores only open at a word boundary, so `file_name_here` keeps its underscores.
  if (marker === '_' && start > 0 && !isWordBoundary(characters[start - 1])) return null

  const wanted = emphasisStyle(length)
  // A style already in force cannot be opened again — `**a **b** c**` would otherwise nest
  // bold inside bold and lose a delimiter.
  if ((style & wanted) === wanted) return null

  const close = closingRun(characters, marker, length, contentStart)
  if (close === null) return null

  return { start: contentStart, end: close, style: wanted, next: close + length }
}

/**
 * Where the matching closing run starts, skipping over code spans and escaped markers so a
 * delimiter inside backticks cannot close emphasis opened outside them.
 */
function closingRun (characters, marker, length, start) {
  let index = start
  while (index < characters.length) {
    const character = characters[index]

    if (character === '\\' && index + 1 < characters.length) { index += 2; continue }
    if (character === '`') {
      const code = codeSpan(characters, index)
      if (code) { index = code.next; continue }
    }
    if (character !== marker) { index += 1; continue }

    const run = runLength(marker, characters, index)
    // A closing run only closes when something non-blank precedes it, and an underscore run
    // must end at a word boundary for the same reason it starts at one.
    const closes = index > start &&
      !isWhitespace(characters[index - 1]) &&
      run >= length &&
      (marker !== '_' || index + run >= characters.length || isWordBoundary(characters[index + run]))
    if (closes) return index
    index += run
  }
  return null
}

/** One marker is italic, two bold, three both. */
function emphasisStyle (length) {
  if (length === 1) return ITALIC
  if (length === 2) return BOLD
  return BOLD | ITALIC
}

function runLength (character, characters, start) {
  let length = 0
  let index = start
  while (index < characters.length && characters[index] === character) { length += 1; index += 1 }
  return length
}

/**
 * Adjacent runs that ended up with the same style are one run, so the layout measures and
 * draws `**a**b` as few pieces rather than many.
 */
export function merge (spans) {
  const merged = []
  for (const piece of spans) {
    if (!piece.text) continue
    const last = merged[merged.length - 1]
    if (last && last.style === piece.style) last.text += piece.text
    else merged.push(span(piece.text, piece.style))
  }
  return merged
}
