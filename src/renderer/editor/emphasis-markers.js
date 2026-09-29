// ⌘B and ⌘I, as range arithmetic. The editor stays a plain-text editor: these put the two
// characters around the selection that the *printer* later reads as bold or italic, and take
// them away again when they are already there. Nothing here renders anything, and nothing here
// knows what `**` means — only the printer does.
//
// Three things make this more than wrapping a range in two strings:
//
// - The markers may be inside the selection (`|**word**|`) or just outside it (`**|word|**`),
//   depending on whether you selected by double-click or by dragging. Both undo the emphasis
//   rather than adding more.
// - `**` and `*` share a character, so a run has to be read for what it *carries*: ⌘I over
//   `**bold**` adds italic, it does not quietly remove the bold.
// - A run of markers cannot span a line. The printer reads emphasis one line at a time, so a
//   selection covering three paragraphs becomes three pairs of markers, not one pair around a
//   block of newlines that would print as four stray asterisks.

import { range, maxRange, merged, wordAt, lineRange, WHITESPACE } from './text-ranges.js'

export const BOLD = '**'
export const ITALIC = '*'

/**
 * Every site's edit, in source order, with the selection each one ends up with once the edits
 * before it have shifted the text along.
 */
export function editsFor (sites, marker, text) {
  const edits = []
  const selections = []
  let shift = 0

  for (const target of targetsFor(sites, text)) {
    const edit = toggle(target, marker, text)
    selections.push(range(edit.range.location + shift + edit.selectionOffset, edit.selectionLength))
    shift += edit.replacement.length - edit.range.length
    edits.push(edit)
  }
  return { edits, selections }
}

/**
 * The ranges an edit actually applies to: one per line of each site, sorted, with duplicates
 * and overlaps merged away.
 *
 * The merge is what keeps a multi-caret ⌘B honest. Two carets inside the same word both resolve
 * to that one word, and editing the same range twice would double its markers.
 */
export function targetsFor (sites, text) {
  const resolved = []
  for (const site of sites) {
    if (site.length === 0) resolved.push(wordAt(site.location, text) ?? site)
    else resolved.push(...linesOf(site, text))
  }
  return merged(resolved)
}

/**
 * `range` cut at line boundaries, each piece trimmed of its newline and of the whitespace at
 * either end, with blank lines dropped. Selecting a paragraph and pressing ⌘B marks the words,
 * not the line breaks between them.
 */
export function linesOf (target, text) {
  const result = []
  let location = target.location
  const end = maxRange(target)

  while (location < end) {
    const line = lineRange(location, text)
    const start = Math.max(line.location, target.location)
    const piece = range(start, Math.max(0, Math.min(maxRange(line), end) - start))
    if (piece.length > 0) {
      const cut = trimmed(piece, text)
      if (cut) result.push(cut)
    }
    location = Math.max(maxRange(line), location + 1)
  }
  return result
}

function trimmed (target, text) {
  let start = target.location
  let end = maxRange(target)
  while (start < end && WHITESPACE.test(text[start])) start += 1
  while (end > start && WHITESPACE.test(text[end - 1])) end -= 1
  return end > start ? range(start, end - start) : null
}

/**
 * The edit that toggles `marker` around `site`. An empty site with a word under it takes the
 * word; an empty site with nothing under it opens an empty pair and leaves the caret between
 * the markers, ready to type into.
 */
export function toggle (site, marker, text) {
  const length = marker.length
  const target = site.length > 0 ? site : (wordAt(site.location, text) ?? site)

  const inside = strippingInside(target, marker, length, text)
  if (inside) return inside
  const outside = strippingOutside(target, marker, length, text)
  if (outside) return outside

  return {
    range: target,
    replacement: marker + text.slice(target.location, maxRange(target)) + marker,
    selectionOffset: length,
    selectionLength: target.length,
  }
}

/**
 * `**word**` selected whole: take one marker's worth off each end, but only when the run there
 * actually carries the emphasis being switched off. ⌘B on `***word***` leaves `*word*` — the
 * bold comes off and the italic stays — while ⌘I on `**word**` strips nothing and adds italic
 * instead, because a bold run is not an italic one.
 */
function strippingInside (site, marker, length, text) {
  if (site.length < length * 2) return null
  const character = marker[0]
  const opening = runOf(character, text, site.location, true)
  const closing = runOf(character, text, maxRange(site) - 1, false)
  if (!carries(marker, Math.min(opening, closing))) return null

  const inner = range(site.location + length, site.length - length * 2)
  return {
    range: site,
    replacement: text.slice(inner.location, maxRange(inner)),
    selectionOffset: 0,
    selectionLength: inner.length,
  }
}

/**
 * `**|word|**` — the markers are just outside what is selected. Widen the edit to take them in,
 * and hand back the same visible text with the selection still on it.
 */
function strippingOutside (site, marker, length, text) {
  const character = marker[0]
  if (site.location < length || maxRange(site) + length > text.length) return null
  const opening = runOf(character, text, site.location - 1, false)
  const closing = runOf(character, text, maxRange(site), true)
  if (!carries(marker, Math.min(opening, closing))) return null

  return {
    range: range(site.location - length, site.length + length * 2),
    replacement: text.slice(site.location, maxRange(site)),
    selectionOffset: 0,
    selectionLength: site.length,
  }
}

/**
 * Whether a run of `count` markers carries the emphasis `marker` stands for. One is italic, two
 * is bold, three is both — and a longer run is read as three, which is how the printer reads it
 * too. This is what stops ⌘I from eating a `**`.
 */
function carries (marker, count) {
  switch (Math.min(3, count)) {
    case 0: return false
    case 1: return marker === ITALIC
    case 2: return marker === BOLD
    default: return true
  }
}

/** How many of `character` run from `start`, counting outward in `forward`'s direction. */
function runOf (character, text, start, forward) {
  if (start < 0 || start >= text.length) return 0
  let count = 0
  let index = start
  while (index >= 0 && index < text.length && text[index] === character) {
    count += 1
    index += forward ? 1 : -1
  }
  return count
}
