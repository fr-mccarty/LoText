// Pure layout: no drawing, no settings object, nothing but font metrics — which arrive as a
// `measure` object so the same code lays out a page whether it is being printed, written to a
// PDF, or measured in a test.
//
// Laying out before drawing is what makes `page N of M` possible: the page count is known
// before the first character is put down.

import { bodyFont, headingFont, letterheadFont, fontKey } from './fonts.js'

/** Space either side of a table cell's text, so columns do not run into each other. */
export const CELL_PADDING = 5
export const RULE_THICKNESS = 0.75
/**
 * A column never squeezes below this, however many there are; the table runs wide and wraps
 * hard instead of collapsing into a stack of single letters.
 */
export const MINIMUM_COLUMN_WIDTH = 24

/**
 * @param {object} measure  `{ width(text, font), lineHeight(font) }`, in points.
 */
export function layout (blocks, settings, contentSize, measure) {
  const m = cached(measure)
  const bands = letterheadBands(settings, m)
  const width = Math.max(1, contentSize.width)
  const bodyHeight = Math.max(1, contentSize.height - bands.header - bands.footer)

  const flow = makeFlow(bodyHeight)
  let isFirstBlock = true

  for (const block of blocks) {
    // Paragraph spacing is the gap *between* blocks, never per line. A heading is its own
    // block, so it gets the gap above and below for free.
    if (!isFirstBlock) flow.y += settings.paragraphSpacing
    isFirstBlock = false

    if (block.kind === 'heading') {
      placeText(block.text, (style) => headingFont(block.level, settings, style), settings, width, flow, m)
    } else if (block.kind === 'paragraph') {
      for (const line of block.lines) {
        placeText(line, (style) => bodyFont(settings, style), settings, width, flow, m)
      }
    } else if (block.kind === 'table') {
      placeTable(block.table, settings, width, flow, m)
    }
  }

  return {
    pages: flow.pages,
    contentSize,
    headerBand: bands.header,
    footerBand: bands.footer,
    pageCount: Math.max(1, flow.pages.length),
  }
}

/**
 * Measurement is asked the same question thousands of times over one document — the width of
 * a word, the height of a font — so the answers are kept.
 */
function cached (measure) {
  const widths = new Map()
  const heights = new Map()
  return {
    width (text, font) {
      const key = `${fontKey(font)}\u0000${text}`
      let value = widths.get(key)
      if (value === undefined) { value = measure.width(text, font); widths.set(key, value) }
      return value
    },
    lineHeight (font, multiple) {
      const key = fontKey(font)
      let single = heights.get(key)
      if (single === undefined) { single = measure.lineHeight(font); heights.set(key, single) }
      return Math.max(1, single * multiple)
    },
  }
}

// MARK: - Flowing text onto pages

/** Pages fill top to bottom; a line never splits across a boundary. */
function makeFlow (bodyHeight) {
  return {
    pages: [{ lines: [], rules: [] }],
    y: 0,
    bodyHeight,
    breakPage () {
      this.pages.push({ lines: [], rules: [] })
      this.y = 0                            // a gap that fell at the page end is dropped
    },
    /**
     * Makes room for something `height` tall, starting a page if it will not fit here.
     * `y > 0` keeps a line taller than the page from looping forever; it prints on its own
     * page instead.
     */
    makeRoom (height) {
      if (this.y > 0 && this.y + height > this.bodyHeight) this.breakPage()
    },
    add (runs, height) {
      this.pages[this.pages.length - 1].lines.push({ runs, y: this.y, height })
      this.y += height
    },
    addRule (rect) {
      this.pages[this.pages.length - 1].rules.push(rect)
    },
  }
}

function placeText (text, fonts, settings, width, flow, m) {
  const base = fonts(0)
  for (const line of wrap(text, fonts, width, m)) {
    // Measured from the fonts actually on this line, not from the unstyled one. A line that
    // is all `code` in a serif preset is drawn in a monospaced face with different metrics,
    // and a slot sized for the serif would let it collide with its neighbours.
    const height = lineHeightOf(line, base, settings.lineSpacingMultiple, m)
    flow.makeRoom(height)
    flow.add(line, height)
  }
}

/** The tallest of the fonts on a line, or the base font's height for an empty line. */
export function lineHeightOf (runs, base, multiple, m) {
  return runs.reduce((tallest, run) => Math.max(tallest, m.lineHeight(run.font, multiple)),
    m.lineHeight(base, multiple))
}

// MARK: - Tables

/**
 * Columns are as wide as their content wants, shrunk in proportion when that overflows the
 * page. A row that will not fit on what is left of a page moves to the next one whole, and
 * the header row is drawn again at the top of it — a table continued over a page break with
 * no headings is a grid of unlabelled numbers.
 */
function placeTable (table, settings, width, flow, m) {
  const columns = table.columnCount
  if (columns <= 0) return

  const bodyFonts = (style) => bodyFont(settings, style)
  const headerFonts = (style) => bodyFont(settings, style | 1 /* BOLD */)
  const multiple = settings.lineSpacingMultiple

  const widths = columnWidths(table, bodyFonts, headerFonts, width, m)
  const origins = columnOrigins(widths)

  /** One row, wrapped once. Height and drawing both come from this, so a cell is never laid
   *  out twice and the two can never disagree about how tall the row is. */
  const measureRow = (cells, fonts) => {
    const wrapped = []
    for (let column = 0; column < columns; column += 1) {
      wrapped.push(wrap(cells[column] ?? [{ text: '', style: 0 }], fonts, textWidth(widths[column]), m))
    }
    // The row's lines are all set on one baseline grid, and the grid is as tall as the
    // tallest font anywhere in the row — a `code` cell in a serif table included.
    let lineHeight = m.lineHeight(fonts(0), multiple)
    for (const cell of wrapped) {
      for (const line of cell) {
        for (const run of line) lineHeight = Math.max(lineHeight, m.lineHeight(run.font, multiple))
      }
    }
    const rows = Math.max(1, ...wrapped.map((cell) => cell.length))
    return { cells: wrapped, lineHeight, height: rows * lineHeight + CELL_PADDING }
  }

  const emit = (row) => {
    const top = flow.y
    for (let column = 0; column < columns; column += 1) {
      const available = textWidth(widths[column])
      row.cells[column].forEach((runs, index) => {
        const alignment = table.alignments[column] ?? 'leading'
        const indent = alignmentOffset(alignment, runs, available, m)
        const placed = offsetRuns(runs, origins[column] + CELL_PADDING + indent)
        flow.pages[flow.pages.length - 1].lines.push({
          runs: placed,
          y: top + index * row.lineHeight,
          height: row.lineHeight,
        })
      })
    }
    flow.y = top + row.height
  }

  const header = measureRow(table.header, headerFonts)
  const tableWidth = origins[columns - 1] + widths[columns - 1]

  const emitHeader = () => {
    flow.addRule({ x: 0, y: flow.y, width: tableWidth, height: RULE_THICKNESS })
    flow.y += RULE_THICKNESS + CELL_PADDING / 2
    emit(header)
    flow.addRule({ x: 0, y: flow.y, width: tableWidth, height: RULE_THICKNESS })
    flow.y += RULE_THICKNESS + CELL_PADDING / 2
  }

  const rows = table.rows.map((row) => measureRow(row, bodyFonts))

  // The header and at least one row belong together: a header alone at the foot of a page
  // says nothing.
  flow.makeRoom(header.height + (rows[0]?.height ?? 0) + RULE_THICKNESS * 2 + CELL_PADDING)
  emitHeader()

  for (const row of rows) {
    if (flow.y > 0 && flow.y + row.height + RULE_THICKNESS > flow.bodyHeight) {
      flow.breakPage()
      emitHeader()
    }
    emit(row)
  }

  flow.addRule({ x: 0, y: flow.y, width: tableWidth, height: RULE_THICKNESS })
  flow.y += RULE_THICKNESS
}

/** What a cell's text has to fit in, once its padding is taken off both sides. */
function textWidth (column) {
  return Math.max(1, column - CELL_PADDING * 2)
}

/**
 * Natural widths, narrowed to fit the page when together they overflow it.
 *
 * The narrowing comes out of the columns that have room to give, not out of all of them
 * equally: a column of three-letter codes is already as narrow as its content, and taking a
 * share from it only to break "Amount" across two lines makes the table worse while the prose
 * column beside it still has inches to spare. So each column gets a floor — its longest
 * single word — and the overflow is taken in proportion to what each column has *above* that
 * floor.
 *
 * Only when the floors themselves do not fit does everything scale together, and then words
 * really do break, because at that point there is no other honest answer.
 */
export function columnWidths (table, fonts, headerFonts, total, m) {
  const columns = table.columnCount
  const widths = []
  for (let column = 0; column < columns; column += 1) {
    let natural = naturalWidth(table.header, column, headerFonts, m)
    for (const row of table.rows) natural = Math.max(natural, naturalWidth(row, column, fonts, m))
    widths.push(natural + CELL_PADDING * 2)
  }

  const sum = widths.reduce((a, b) => a + b, 0)
  if (sum <= total || sum <= 0) return widths

  const floors = []
  for (let column = 0; column < columns; column += 1) {
    let word = longestWordWidth(table.header, column, headerFonts, m)
    for (const row of table.rows) word = Math.max(word, longestWordWidth(row, column, fonts, m))
    // Never above the natural width: a floor wider than the column wants would make a column
    // that fits look like one that needs room.
    floors.push(Math.min(widths[column], Math.max(MINIMUM_COLUMN_WIDTH, word + CELL_PADDING * 2)))
  }

  const overflow = sum - total
  const slack = widths.map((width, index) => Math.max(0, width - floors[index]))
  const available = slack.reduce((a, b) => a + b, 0)

  if (available >= overflow) {
    return widths.map((width, index) => width - overflow * (slack[index] / available))
  }

  // Even at their floors the columns do not fit. Scale the floors down together and let the
  // wrap break words; the table stays on the page, which is the thing that matters.
  const floorSum = floors.reduce((a, b) => a + b, 0)
  const scale = floorSum > 0 ? Math.min(1, total / floorSum) : 1
  return floors.map((floor) => Math.max(1, floor * scale))
}

/** The widest single word in a column: how narrow it can be before a word has to break. */
function longestWordWidth (row, column, fonts, m) {
  if (column >= row.length) return 0
  let widest = 0
  for (const piece of row[column]) {
    for (const token of tokensOf(piece.text)) {
      const word = token.trim()
      if (!word) continue
      widest = Math.max(widest, m.width(word, fonts(piece.style)))
    }
  }
  return widest
}

function naturalWidth (row, column, fonts, m) {
  if (column >= row.length) return 0
  return row[column].reduce((total, piece) => total + m.width(piece.text, fonts(piece.style)), 0)
}

function columnOrigins (widths) {
  const origins = []
  let x = 0
  for (const width of widths) { origins.push(x); x += width }
  return origins
}

export function alignmentOffset (alignment, line, available, m) {
  if (alignment === 'leading') return 0
  const used = widthOfRuns(line, m)
  const slack = Math.max(0, available - used)
  return alignment === 'center' ? slack / 2 : slack
}

export function widthOfRuns (runs, m) {
  const last = runs[runs.length - 1]
  if (!last) return 0
  return last.x + m.width(last.text, last.font)
}

function offsetRuns (runs, dx) {
  return runs.map((run) => ({ text: run.text, font: run.font, x: run.x + dx }))
}

// MARK: - Word wrap

/**
 * Greedy wrap at word boundaries, across styles. A word too wide for the content width is
 * broken by character, so nothing is ever clipped or runs off the page. Continuations carry
 * no added indent — only the whitespace that caused the break is dropped.
 */
export function wrap (text, fonts, width, m) {
  const lines = []
  let current = []
  let used = 0
  let isFirstToken = true

  const flush = () => { lines.push(current); current = []; used = 0 }
  const token = (piece, font) => ({ text: piece, font, width: m.width(piece, font) })

  for (const piece of text) {
    const font = fonts(piece.style)
    for (const raw of tokensOf(piece.text)) {
      let item = token(raw, font)

      // The first token of the block keeps the line's own leading indent; at every later
      // break the whitespace that caused the break is dropped.
      if (!isFirstToken && !current.length) item = token(raw.replace(/^\s+/, ''), font)
      isFirstToken = false
      if (!item.text) continue

      if (current.length && used + item.width > width) {
        flush()
        item = token(raw.replace(/^\s+/, ''), font)
        if (!item.text) continue
      }

      // Still too wide on a line of its own: break it by character.
      while (used + item.width > width) {
        const head = longestFittingPrefix(item.text, font, width - used, m)
        if (!head || head.length >= item.text.length) break
        current.push(token(head, font))
        item = token(item.text.slice(head.length), font)
        flush()
      }

      current.push(item)
      used += item.width
    }
  }
  // A line that wrapped and ended in trailing whitespace has nothing left in `current`;
  // flushing that would cost the paragraph a blank line it never had. An empty *text*, though,
  // is still one empty line — a blank source line takes up a line on the page.
  if (current.length || !lines.length) flush()

  return lines.map((tokens) => runsOf(tokens, m))
}

/**
 * Turns a line's tokens into runs, merging neighbours that share a font so a plain line is one
 * draw rather than one per word, and measuring each merged run to place the next.
 */
function runsOf (tokens, m) {
  const runs = []
  let text = ''
  let font = null
  let x = 0

  const flush = () => {
    if (!font || !text) return
    runs.push({ text, font, x })
    x += m.width(text, font)
    text = ''
  }

  for (const token of tokens) {
    if (font && fontKey(font) !== fontKey(token.font)) flush()
    font = token.font
    text += token.text
  }
  flush()
  return runs
}

/**
 * Splits into break-opportunity tokens: each token is a run of whitespace plus the
 * non-whitespace run that follows it, so the first token keeps any source indent.
 */
export function tokensOf (text) {
  const result = []
  let current = ''
  let sawNonWhitespace = false
  for (const character of text) {
    if (/\s/.test(character)) {
      if (sawNonWhitespace) { result.push(current); current = ''; sawNonWhitespace = false }
    } else {
      sawNonWhitespace = true
    }
    current += character
  }
  if (current) result.push(current)
  return result
}

/** Longest prefix that fits, by character count, never shorter than one character. */
export function longestFittingPrefix (text, font, width, m) {
  const characters = Array.from(text)
  let low = 1
  let high = characters.length
  let best = 1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (m.width(characters.slice(0, mid).join(''), font) <= width) { best = mid; low = mid + 1 }
    else high = mid - 1
  }
  return characters.slice(0, best).join('')
}

/**
 * How much of the page the letterhead takes, top and bottom. Empty slots take nothing: a
 * letterhead with only a footer leaves the body the whole top of the page. A header or footer
 * image makes its band at least as tall as the image prints.
 *
 * The band is reserved on every page even when the header only prints on the first, so the
 * body text starts at the same place on page one and page two.
 */
export function letterheadBands (settings, m) {
  if (!settings.showsHeaderAndFooter) return { header: 0, footer: 0 }
  const letterhead = settings.letterhead
  const lineHeight = m.lineHeight(letterheadFont(settings), 1)
  const padding = 8
  const band = (header) => {
    const text = slotLines(letterhead, header) * lineHeight
    const image = imageHeightPoints(header ? letterhead.headerImage : letterhead.footerImage)
    // An image fills its box to the edge, where text has its descent below it: a little air
    // keeps the rule under the header off the picture.
    return Math.max(text, image ? image + 4 : 0) + padding
  }
  return {
    header: hasHeader(letterhead) ? band(true) : 0,
    footer: hasFooter(letterhead) ? band(false) : 0,
  }
}

export function hasHeader (letterhead) {
  return Boolean(letterhead.headerLeft || letterhead.headerCenter || letterhead.headerRight ||
    letterhead.headerImage)
}

export function hasFooter (letterhead) {
  return Boolean(letterhead.footerLeft || letterhead.footerCenter || letterhead.footerRight ||
    letterhead.footerImage)
}

/** How tall a letterhead image prints, in points; none is nothing. */
export function imageHeightPoints (image) {
  return image ? image.height * 72 : 0
}

/** The most lines any one slot in the band holds, which decides how tall the band has to be. */
export function slotLines (letterhead, header) {
  const slots = header
    ? [letterhead.headerLeft, letterhead.headerCenter, letterhead.headerRight]
    : [letterhead.footerLeft, letterhead.footerCenter, letterhead.footerRight]
  return slots.reduce((most, slot) => Math.max(most, slot ? slot.split('\n').length : 0), 0)
}
