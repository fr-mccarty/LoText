// The quick-open matcher, and the only part of file search that has no view in it.
//
// A query matches a path when its characters appear in that path **in order**, not necessarily
// together — `psettings` finds `Settings/PrintSettingsTab.swift`. Since a query usually fits a
// path several ways, the score is the best of them, found with a dynamic program over the path
// rather than by taking the first fit greedily: the greedy fit for `pst` in
// `Printing/PrintSettings.swift` starts at `Printing`, and the fit the user meant is the one
// entirely inside the name.
//
// Rank, in the order the weights enforce it:
//
//   1. matches inside the file's own name beat matches spread across its folders,
//   2. contiguous runs beat scattered characters,
//   3. characters landing on a word boundary — after `/`, `-`, `_`, `.`, or on a camelCase hump
//      — beat characters landing in the middle of a word,
//   4. a shorter path breaks what is otherwise a tie.

import * as FilePath from '../shared/file-path.js'

/** Credit for matching a character at all, before any positional bonus. */
const MATCH_SCORE = 16
/** Extra credit for a character that continues the previous match with no gap. */
const CONTIGUOUS_BONUS = 14
/** Charged per skipped character between two matched ones. */
const GAP_PENALTY = 2
const IMPOSSIBLE = -1e9

/** The first character of the path, and the first character of the name. */
const START_BONUS = 18
/** Immediately after `/`, `_`, `-`, `.`, a space, and the rest of filename punctuation. */
const BOUNDARY_BONUS = 12
/** The `S` in `PrintSettings`, which reads as a word boundary even without punctuation. */
const CAMEL_BONUS = 10
/** Applies to every position inside the file's own name. */
const NAME_BONUS = 8

const SEPARATORS = new Set(['/', '_', '-', '.', ' ', '(', ')', '[', ']', '{', '}', '@', '+', ',', ';', '~', '#'])

/**
 * ASCII in one comparison, anything else through the platform — case *and* accent, so that
 * `cafe` finds `Café.md`: nobody reaches for the option key halfway through a search.
 *
 * Kept character-for-character. A fold that changed the length would misalign the folded path
 * with its bonuses, so a character that folds to more than one is left as it was; it still
 * matches itself, which is the worst that can happen.
 */
export function fold (character) {
  const code = character.charCodeAt(0)
  if (code < 128) return code >= 65 && code <= 90 ? character.toLowerCase() : character
  const folded = character.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  return folded.length === 1 ? folded : character.toLowerCase()
}

function isUpper (character) {
  return character !== character.toLowerCase() && character === character.toUpperCase()
}

function isLowerOrDigit (character) {
  return /[a-z0-9]/.test(character) || (character !== character.toUpperCase())
}

/**
 * One file the ⇧⌘P sheet can offer, prepared for matching rather than for drawing. The two
 * arrays are built once, when the folder is walked, and read on every keystroke afterwards:
 * scoring twenty thousand paths has to be cheap enough to run between one character and the
 * next, and lowercasing a string twenty thousand times per keystroke is not.
 */
export function makeCandidate (path) {
  const name = FilePath.name(path)
  const folder = FilePath.parent(path) ?? ''
  const raw = Array.from(path)
  // The name starts after the last separator, which is where `folder` ends.
  const nameStart = raw.length - Array.from(name).length

  const lowered = raw.map(fold)
  const bonuses = new Int32Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) {
    let bonus = 0
    if (index === 0 || index === nameStart) bonus += START_BONUS
    else if (SEPARATORS.has(lowered[index - 1])) bonus += BOUNDARY_BONUS
    else if (isLowerOrDigit(raw[index - 1]) && isUpper(raw[index])) bonus += CAMEL_BONUS
    // Flat credit for being in the name at all, which is what makes a match on the file's own
    // name beat the same match spelled out across its folders.
    if (index >= nameStart) bonus += NAME_BONUS
    bonuses[index] = bonus
  }

  return {
    path,
    name,
    folder,
    lowered,
    bonuses,
    nameLength: raw.length - nameStart,
    depth: FilePath.depth(path),
  }
}

/**
 * What the user typed, folded once so that every candidate is measured against the same array.
 * Whitespace is dropped rather than matched: a stray space in a query typed at speed is not a
 * reason to find nothing.
 */
export function makeQuery (text) {
  return Array.from(String(text ?? '')).filter((character) => !/\s/.test(character)).map(fold)
}

/** Null when the query is not a subsequence of the path at all. Higher is better. */
export function score (candidate, pattern) {
  const text = candidate.lowered
  // An empty query matches everything equally, which lists the folder in its own order until
  // the user has typed something.
  if (!pattern.length) return 0
  if (pattern.length > text.length) return null
  // The cheap test first. Nearly every candidate fails here, and failing here costs one pass
  // over the path rather than one pass per query character.
  if (!isSubsequence(pattern, text)) return null

  const width = text.length
  let previous = new Float64Array(width).fill(IMPOSSIBLE)
  let current = new Float64Array(width).fill(IMPOSSIBLE)

  for (let position = 0; position < width; position += 1) {
    if (text[position] === pattern[0]) previous[position] = MATCH_SCORE + candidate.bonuses[position]
  }

  for (let index = 1; index < pattern.length; index += 1) {
    const wanted = pattern[index]
    // The best way to have matched everything before `wanted`, decayed by one gap penalty per
    // character walked past. Carrying it forward is what keeps this linear in the path length.
    let carried = IMPOSSIBLE
    for (let position = 0; position < width; position += 1) {
      if (position > 0) carried = Math.max(carried - GAP_PENALTY, previous[position - 1])
      if (text[position] !== wanted || carried <= IMPOSSIBLE) { current[position] = IMPOSSIBLE; continue }
      let best = carried + MATCH_SCORE + candidate.bonuses[position]
      // Arriving straight from the character before is the contiguous case, and it is worth
      // more than the same arrival with something skipped in between.
      const adjacent = position > 0 ? previous[position - 1] : IMPOSSIBLE
      if (adjacent > IMPOSSIBLE) {
        best = Math.max(best, adjacent + MATCH_SCORE + CONTIGUOUS_BONUS + candidate.bonuses[position])
      }
      current[position] = best
    }
    const swap = previous
    previous = current
    current = swap
    current.fill(IMPOSSIBLE)
  }

  let best = IMPOSSIBLE
  for (const value of previous) if (value > best) best = value
  if (best <= IMPOSSIBLE) return null
  // The tie-break, and deliberately small: it settles two equally good matches without ever
  // outweighing where in the path those matches landed.
  return best - width / 8
}

function isSubsequence (pattern, text) {
  let index = 0
  for (const character of text) {
    if (character === pattern[index]) {
      index += 1
      if (index === pattern.length) return true
    }
  }
  return false
}

/**
 * The whole pass: score every candidate, order the ones that matched, and hand back at most
 * `limit` of them. Quick-open is a keyboard tool — nobody scrolls to the four hundredth match,
 * they type another letter.
 */
export function matches (candidates, pattern, limit) {
  if (!pattern.length) return candidates.slice(0, limit)
  const ranked = []
  for (let index = 0; index < candidates.length; index += 1) {
    const value = score(candidates[index], pattern)
    if (value === null) continue
    ranked.push({ score: value, index })
  }
  // Score first, then the shorter name, then the shallower path, and finally the order the walk
  // found them in — which is breadth-first and alphabetical within a folder, and is what keeps
  // the list from reshuffling between two identical queries.
  ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    const left = candidates[a.index]
    const right = candidates[b.index]
    if (left.nameLength !== right.nameLength) return left.nameLength - right.nameLength
    if (left.depth !== right.depth) return left.depth - right.depth
    return a.index - b.index
  })
  return ranked.slice(0, limit).map((item) => candidates[item.index])
}
