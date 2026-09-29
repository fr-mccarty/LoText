// ⌥↑ and ⌥↓ (Edit ▸ Move Line Up / Down) move whole items: an enhanced task with everything under
// it, and a closed disclosure with its body. Anything else moves a line at a time, except that a
// closed item counts as one line, its head with its hidden lines, so a plain line can still step
// into and out of an open section but never lands among hidden lines. Pure functions over
// arrays of lines, built on the parsers; `enhanced-view.js` is the CodeMirror side.
// The specs are the “Moving” sections of `specs/enhanced-tasks.md` and `specs/disclosures.md`.
//
// Line numbers are 0-based, and a span is { first, last }, inclusive.

import { parseTasks, hiddenLines as taskHidden } from './enhanced-tasks.js'
import { parseDisclosures, reservedLines } from './disclosures.js'

/**
 * What the moving rules need from the text: every task and disclosure as a span, the heads that
 * bring their whole span with them (a task's line, a closed disclosure's line when it has a
 * body), which item owns each hidden line, and the folds — each run of hidden lines, keyed both
 * by the visible line it is drawn on (`foldAfter`) and by each of its lines (`foldOf`).
 */
function survey (lines) {
  const tasks = parseTasks(lines)
  const disclosures = parseDisclosures(lines, { skip: reservedLines(lines, tasks) })
  const spans = []
  const heads = new Map()
  const owners = new Map()
  for (const task of tasks) {
    const span = { first: task.line, last: task.lastLine }
    spans.push(span)
    heads.set(task.line, span)
    for (const { first, last } of taskHidden(task)) {
      for (let line = first; line <= last; line++) owners.set(line, span)
    }
  }
  // Outer disclosures come before the ones nested in them, so a hidden line's owner is the
  // outermost closed one — unless a task already hides it.
  for (const disclosure of disclosures) {
    const span = { first: disclosure.line, last: disclosure.lastLine }
    spans.push(span)
    if (disclosure.open || !disclosure.body) continue
    heads.set(disclosure.line, span)
    for (let line = disclosure.body[0]; line <= disclosure.body[1]; line++) {
      if (!owners.has(line)) owners.set(line, span)
    }
  }
  const foldAfter = new Map()
  const foldOf = new Map()
  const hidden = [...owners.keys()].sort((a, b) => a - b)
  for (let index = 0; index < hidden.length;) {
    let end = index
    while (end + 1 < hidden.length && hidden[end + 1] === hidden[end] + 1) end++
    const fold = { first: hidden[index], last: hidden[end] }
    foldAfter.set(fold.first - 1, fold)
    for (let line = fold.first; line <= fold.last; line++) foldOf.set(line, fold)
    index = end + 1
  }
  return { spans, heads, owners, foldAfter, foldOf }
}

/**
 * The lines a selection covering `first`…`last` moves: grown until every task line or closed
 * disclosure line in it has its whole span, and every hidden line its owner's. `block` says
 * whether it holds such a head, and so moves as an item.
 */
function expand ({ heads, owners }, { first, last }) {
  let grown = true
  while (grown) {
    grown = false
    for (let line = first; line <= last; line++) {
      const span = heads.get(line) ?? owners.get(line)
      if (span && (span.first < first || span.last > last)) {
        first = Math.min(first, span.first)
        last = Math.max(last, span.last)
        grown = true
      }
    }
  }
  let block = false
  for (let line = first; line <= last && !block; line++) block = heads.has(line)
  return { first, last, block }
}

/**
 * What a group steps over: for an item, the largest task or disclosure (open or closed, with its
 * body) that holds the line next to it and ends there, so the item never lands inside another.
 * For anything else, the next line as it is drawn, a line with a fold under it going with its
 * hidden lines. So a plain line never lands among hidden lines.
 */
function neighbour ({ spans, foldAfter, foldOf }, group, direction) {
  const next = direction < 0 ? group.first - 1 : group.last + 1
  let unit = { first: next, last: next }
  const fold = direction < 0 ? foldOf.get(next) : foldAfter.get(next)
  if (fold) unit = direction < 0 ? { first: fold.first - 1, last: next } : { first: next, last: fold.last }
  if (!group.block) return unit
  for (const span of spans) {
    const touching = direction < 0 ? span.last === next : span.first === next
    if (touching && span.last - span.first > unit.last - unit.first) unit = span
  }
  return unit
}

/**
 * Moves the lines each selection covers one step up (`direction` -1) or down (+1), items whole.
 * `ranges` are the selections as line spans [{ first, last }]. Touching ones move together. A
 * group already at the top (or bottom) stays where it is.
 *
 * Answers { lines, shifts } — the new lines, and how many lines each range moved by, in the order
 * given — or null when nothing moves. Lines keep their text exactly.
 */
export function moveBlocks (lines, ranges, direction) {
  const current = [...lines]
  let facts = survey(current)
  const groups = []
  const sorted = ranges.map((range, index) => ({ ...expand(facts, range), members: [index] }))
    .sort((a, b) => a.first - b.first)
  for (const group of sorted) {
    const previous = groups[groups.length - 1]
    if (previous && group.first <= previous.last + 1) {
      previous.last = Math.max(previous.last, group.last)
      previous.block ||= group.block
      previous.members.push(...group.members)
    } else {
      groups.push(group)
    }
  }

  // Each group's move stays on its own side of the next group, so moving them nearest-first
  // leaves the others' lines where they were.
  if (direction > 0) groups.reverse()
  const shifts = ranges.map(() => 0)
  let moved = false
  for (const group of groups) {
    if (direction < 0 ? group.first === 0 : group.last === current.length - 1) continue
    if (moved) facts = survey(current)
    const unit = neighbour(facts, group, direction)
    const block = current.slice(group.first, group.last + 1)
    const over = current.slice(unit.first, unit.last + 1)
    const start = Math.min(group.first, unit.first)
    current.splice(start, block.length + over.length, ...(direction < 0 ? [...block, ...over] : [...over, ...block]))
    for (const member of group.members) shifts[member] = direction * over.length
    moved = true
  }
  return moved ? { lines: current, shifts } : null
}
