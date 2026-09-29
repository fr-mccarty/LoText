import { describe, it, expect } from 'vitest'
import { parseInline, merge, span, BOLD, ITALIC, CODE } from '../src/shared/markdown/inline.js'

/** Spans as `text|style` pairs — compact enough to read an expectation at a glance. */
const shape = (line) => parseInline(line).map((s) => `${s.text}|${s.style}`)

describe('parseInline — the styles the dialect knows', () => {
  it('leaves plain text as one unstyled run', () => {
    expect(shape('just words')).toEqual(['just words|0'])
  })

  it('never returns an empty array, so a caller can always ask a line for its font', () => {
    expect(parseInline('')).toEqual([span('')])
  })

  it('reads **bold**, *italic*, ***both*** and `code`', () => {
    expect(shape('**b**')).toEqual([`b|${BOLD}`])
    expect(shape('*i*')).toEqual([`i|${ITALIC}`])
    expect(shape('***x***')).toEqual([`x|${BOLD | ITALIC}`])
    expect(shape('`c`')).toEqual([`c|${CODE}`])
  })

  it('never looks inside a code span, so ** in backticks is two asterisks', () => {
    expect(shape('`**a**`')).toEqual([`**a**|${CODE}`])
  })
})

describe('parseInline — anything unrecognised prints literally', () => {
  // The module's stated contract: "a file full of asterisks that mean asterisks
  // must not come out mangled."

  it('treats a lone asterisk between spaces as arithmetic, not emphasis', () => {
    expect(shape('2 * 3')).toEqual(['2 * 3|0'])
  })

  it('honours a backslash escape', () => {
    expect(shape('2 * 3 \\* 4')).toEqual(['2 * 3 * 4|0'])
  })

  it('keeps the backslash on anything that is not markdown punctuation', () => {
    expect(shape('C:\\Users\\josh')).toEqual(['C:\\Users\\josh|0'])
  })

  it('keeps underscores inside a word', () => {
    expect(shape('file_name_here')).toEqual(['file_name_here|0'])
  })

  it('prints an unclosed run as the characters it is', () => {
    expect(shape('**not closed')).toEqual(['**not closed|0'])
    expect(shape('`not closed')).toEqual(['`not closed|0'])
  })

  // Links and blockquotes are deliberately NOT part of this dialect. These tests
  // pin that intent so nobody "fixes" it into half a markdown implementation.
  it('leaves link syntax alone', () => {
    expect(shape('a [link](https://example.com).')).toEqual(['a [link](https://example.com).|0'])
  })
})

describe('parseInline — the line that prints with a gap', () => {
  // Regression guard for the PDF defect: the gap is NOT introduced here.
  // If this test ever fails, the bug moved into inline.js.
  it('consumes the ** markers without leaving stray whitespace', () => {
    expect(shape('A folder-based editor: **one window is one folder**, and')).toEqual([
      'A folder-based editor: |0',
      `one window is one folder|${BOLD}`,
      ', and|0',
    ])
  })
})

describe('merge', () => {
  it('joins adjacent runs that share a style and drops empty ones', () => {
    expect(merge([span('a'), span(''), span('b'), span('c', BOLD)]))
      .toEqual([span('ab'), span('c', BOLD)])
  })
})
