import { describe, it, expect } from 'vitest'
import { parseBlocks } from '../src/shared/markdown/blocks.js'
import { layout } from '../src/shared/print/layout.js'
import { pixelsToPoints, POINTS_PER_PIXEL } from '../src/shared/print/fonts.js'
import { standardPreset, snapshot } from '../src/shared/settings-shape.js'

describe('pixelsToPoints', () => {
  // The printer measures with a canvas, which answers in CSS pixels, and draws in `pt`.
  // Skipping this conversion put every run on a styled line 33% too far right.
  it('converts CSS pixels to points at the fixed 72/96 ratio', () => {
    expect(POINTS_PER_PIXEL).toBe(0.75)
    expect(pixelsToPoints(96)).toBe(72)   // one CSS inch is 72pt
    expect(pixelsToPoints(0)).toBe(0)
  })
})

/** A monospace measure: every glyph one unit wide, so widths are just character counts. */
const CH = 8
const measure = { width: (text) => text.length * CH, lineHeight: () => 12 }
const settings = { ...snapshot(standardPreset()), lineSpacingMultiple: 1, paragraphSpacing: 0 }

const runsOfFirstLine = (source) => {
  const result = layout(parseBlocks(source), settings, { width: 10000, height: 10000 }, measure)
  return result.pages[0].lines[0].runs
}

describe('layout — runs on a line are laid end to end', () => {
  it('leaves no gap where a style changes', () => {
    const runs = runsOfFirstLine('AAAA **BBBB** CCCC')
    expect(runs.map((r) => r.text)).toEqual(['AAAA ', 'BBBB', ' CCCC'])

    let expectedX = 0
    for (const run of runs) {
      expect(run.x).toBe(expectedX)
      expectedX += measure.width(run.text)
    }
  })

  it('ends a styled line exactly where the same text unstyled ends', () => {
    // The invariant the gap broke: emphasis changes the face, never the advance.
    const plain = runsOfFirstLine('AAAA BBBB CCCC')
    const bold = runsOfFirstLine('AAAA **BBBB** CCCC')
    const end = (runs) => {
      const last = runs[runs.length - 1]
      return last.x + measure.width(last.text)
    }
    expect(end(bold)).toBe(end(plain))
    expect(end(runsOfFirstLine('AAAA *BBBB* CCCC'))).toBe(end(plain))
    expect(end(runsOfFirstLine('AAAA `BBBB` CCCC'))).toBe(end(plain))
  })

  it('marks the styled run bold and leaves its neighbours alone', () => {
    const [before, middle, after] = runsOfFirstLine('AAAA **BBBB** CCCC')
    expect(middle.font.bold).toBe(true)
    expect(before.font.bold).toBe(false)
    expect(after.font.bold).toBe(false)
  })
})
