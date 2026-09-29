import { describe, it, expect } from 'vitest'
import {
  range, maxRange, wordAt, occurrenceOf, lineRange, linesTouchedBy, deletionsForLines,
  lineMove, union, caretsAfterReplacing, merged,
} from '../src/renderer/editor/text-ranges.js'

/** Apply a `lineMove` result to `text`, the way the editor does. */
const applyMove = (text, move) =>
  text.slice(0, move.range.location) + move.replacement + text.slice(maxRange(move.range))

/** Delete every range from `text`, back to front. */
const deleteAll = (text, ranges) =>
  [...ranges].reverse().reduce((out, r) => out.slice(0, r.location) + out.slice(maxRange(r)), text)

describe('wordAt', () => {
  it('finds the word the caret is inside', () => {
    expect(wordAt(6, 'hello world')).toEqual(range(6, 5))
  })

  it('gives a caret just past a word to that word', () => {
    expect(wordAt(5, 'hello world')).toEqual(range(0, 5))
    expect(wordAt(11, 'hello world')).toEqual(range(6, 5))
  })

  it('counts letters, digits and underscores, in any script', () => {
    expect(wordAt(0, 'snake_case2 x')).toEqual(range(0, 11))
    expect(wordAt(1, 'café!')).toEqual(range(0, 4))
  })

  it('is null when no word touches the caret', () => {
    expect(wordAt(1, 'a  b')).toEqual(range(0, 1))
    expect(wordAt(2, 'a  b')).toBeNull()
    expect(wordAt(0, '')).toBeNull()
  })
})

describe('occurrenceOf', () => {
  it('finds the next occurrence after the position', () => {
    expect(occurrenceOf('ab', 1, 'ab ab ab')).toEqual(range(3, 2))
  })

  it('wraps to the top past the last one', () => {
    expect(occurrenceOf('ab', 7, 'ab ab ab')).toEqual(range(0, 2))
  })

  it('is null when the text is absent or the needle empty', () => {
    expect(occurrenceOf('zz', 0, 'ab ab')).toBeNull()
    expect(occurrenceOf('', 0, 'ab ab')).toBeNull()
  })
})

describe('lineRange', () => {
  const text = 'one\ntwo\nthree'

  it('includes the newline that ends the line', () => {
    expect(lineRange(5, text)).toEqual(range(4, 4))
    expect(lineRange(0, text)).toEqual(range(0, 4))
  })

  it('treats a position on a newline as the end of that line', () => {
    expect(lineRange(3, text)).toEqual(range(0, 4))
  })

  it('runs to the end of a last line with no newline', () => {
    expect(lineRange(10, text)).toEqual(range(8, 5))
    expect(lineRange(13, text)).toEqual(range(8, 5))
  })

  it('clamps a position outside the text', () => {
    expect(lineRange(-3, text)).toEqual(range(0, 4))
    expect(lineRange(99, text)).toEqual(range(8, 5))
  })
})

describe('linesTouchedBy', () => {
  it('gives one entry per distinct line, in order', () => {
    const text = 'a\nb\nc\n'
    expect(linesTouchedBy([range(0), range(1), range(4)], text)).toEqual([range(0, 2), range(4, 2)])
  })
})

describe('deletionsForLines — ⌘X on whole lines', () => {
  it('deletes lines as they are when each ends in a newline', () => {
    const text = 'a\nb\nc\n'
    const lines = [range(2, 2)]
    expect(deleteAll(text, deletionsForLines(lines, text))).toBe('a\nc\n')
  })

  it('eats the newline in front of a last line that has none, leaving no blank line', () => {
    const text = 'a\nb\nc'
    const lines = [lineRange(4, text)]
    expect(deleteAll(text, deletionsForLines(lines, text))).toBe('a\nb')
  })

  it('leaves a sole unterminated line as it is', () => {
    const text = 'only'
    expect(deletionsForLines([range(0, 4)], text)).toEqual([range(0, 4)])
  })

  it('passes an empty list through', () => {
    expect(deletionsForLines([], 'abc')).toEqual([])
  })
})

describe('lineMove — ⌥↑ / ⌥↓', () => {
  it('moves a line up past its neighbour', () => {
    const text = 'a\nb\nc\n'
    const move = lineMove([range(2)], -1, text)
    expect(applyMove(text, move)).toBe('b\na\nc\n')
    expect(move.shift).toBe(-2)
  })

  it('moves a line down past its neighbour', () => {
    const text = 'a\nb\nc\n'
    const move = lineMove([range(0)], 1, text)
    expect(applyMove(text, move)).toBe('b\na\nc\n')
    expect(move.shift).toBe(2)
  })

  it('does not drag a missing newline around with the last line', () => {
    expect(applyMove('a\nb', lineMove([range(2)], -1, 'a\nb'))).toBe('b\na')
    expect(applyMove('a\nb', lineMove([range(0)], 1, 'a\nb'))).toBe('b\na')
  })

  it('moves every line the selection touches, as a block', () => {
    const text = 'a\nb\nc\nd\n'
    // From inside `b` to inside `c`.
    const move = lineMove([range(2, 3)], 1, text)
    expect(applyMove(text, move)).toBe('a\nd\nb\nc\n')
  })

  it('does not count the line a selection ends at the very start of', () => {
    const text = 'a\nb\nc\n'
    // `a\n` selected in full: the caret end sits at the start of `b`, which does not move.
    const move = lineMove([range(0, 2)], 1, text)
    expect(applyMove(text, move)).toBe('b\na\nc\n')
  })

  it('is null at the ends of the file', () => {
    expect(lineMove([range(0)], -1, 'a\nb')).toBeNull()
    expect(lineMove([range(2)], 1, 'a\nb')).toBeNull()
  })

  it('will not move the empty position after the final newline', () => {
    expect(lineMove([range(4)], -1, 'a\nb\n')).toBeNull()
  })

  it('is null with no offset or no positions', () => {
    expect(lineMove([range(0)], 0, 'a\nb')).toBeNull()
    expect(lineMove([], 1, 'a\nb')).toBeNull()
  })
})

describe('union', () => {
  it('spans both ranges and anything between', () => {
    expect(union(range(5, 2), range(1, 1))).toEqual(range(1, 6))
  })
})

describe('caretsAfterReplacing', () => {
  it('shifts each caret by every earlier replacement', () => {
    // Replacing two 3-character words with 1 character each.
    expect(caretsAfterReplacing([range(0, 3), range(4, 3)], 1)).toEqual([range(1), range(3)])
  })
})

describe('merged', () => {
  it('sorts and joins overlapping or touching ranges', () => {
    expect(merged([range(5, 2), range(0, 3), range(3, 1)])).toEqual([range(0, 4), range(5, 2)])
  })

  it('collapses two carets in the same place into one', () => {
    expect(merged([range(3), range(3)])).toEqual([range(3)])
  })

  it('keeps two carets at different places apart', () => {
    expect(merged([range(4), range(1)])).toEqual([range(1), range(4)])
  })
})
