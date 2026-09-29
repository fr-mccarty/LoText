// The printer's own window: it never shows, it lays out one file, and it draws it.
//
// This is the same layout code a test would call, given a real text engine to measure with.
// Laying out before drawing is what makes `page N of M` possible — and drawing from the
// layout rather than from the source is what keeps the page on paper identical to the page
// in the PDF.

import { parseBlocks } from '../../shared/markdown/blocks.js'
import { layout, hasHeader, hasFooter, imageHeightPoints } from '../../shared/print/layout.js'
import { cssFont, letterheadFont, pixelsToPoints } from '../../shared/print/fonts.js'
import { resolveLetterhead } from './letterhead-text.js'

/** Canvas metrics, in points. The one place the text engine is asked anything. */
const canvas = document.createElement('canvas')
const context = canvas.getContext('2d')

const measure = {
  width (text, font) {
    context.font = cssFont(font)
    return pixelsToPoints(context.measureText(text).width)
  },
  /**
   * Ascender − descender + leading, which is what one line of this font occupies. Taken from
   * the font's own box rather than from a rendered string, so an empty line is as tall as a
   * full one.
   */
  lineHeight (font) {
    context.font = cssFont(font)
    const metrics = context.measureText('Hxg')
    // The fallbacks are already point sizes; only what the canvas answers needs converting.
    const ascent = metrics.fontBoundingBoxAscent != null
      ? pixelsToPoints(metrics.fontBoundingBoxAscent)
      : font.size * 1.0
    const descent = metrics.fontBoundingBoxDescent != null
      ? pixelsToPoints(metrics.fontBoundingBoxDescent)
      : font.size * 0.25
    return Math.max(1, ascent + descent)
  },
}

window.laidOut = null

/**
 * Draws the whole document and answers with its page count, which is what the caller needs in
 * order to say `page N of M` anywhere outside the pages themselves. Answers once every letterhead
 * image has decoded, so nothing prints before its picture is there.
 */
window.renderJob = async function renderJob (job) {
  const { text, settings, context: jobContext, paper } = job
  const blocks = parseBlocks(text)
  const contentSize = {
    width: Math.max(1, paper.width - settings.leftMarginPoints - settings.rightMarginPoints),
    height: Math.max(1, paper.height - settings.topMarginPoints - settings.bottomMarginPoints),
  }
  const result = layout(blocks, settings, contentSize, measure)
  setPageSize(paper)

  const container = document.getElementById('pages')
  container.textContent = ''
  for (let index = 0; index < result.pageCount; index += 1) {
    container.appendChild(drawPage(index, result, settings, jobContext, paper))
  }
  await Promise.all([...container.querySelectorAll('img')].map((image) => image.decode().catch(() => {})))
  window.laidOut = { pageCount: result.pageCount }
  return result.pageCount
}

/** The sheet the print panel is asked for, so it neither scales the pages nor adds margins. */
function setPageSize (paper) {
  let rule = document.getElementById('page-size')
  if (!rule) {
    rule = document.createElement('style')
    rule.id = 'page-size'
    document.head.appendChild(rule)
  }
  rule.textContent = `@page { size: ${paper.width}pt ${paper.height}pt; margin: 0; }`
}

function drawPage (index, result, settings, jobContext, paper) {
  const page = document.createElement('div')
  page.className = 'page'
  page.style.width = `${paper.width}pt`
  page.style.height = `${paper.height}pt`

  const originX = settings.leftMarginPoints
  const originY = settings.topMarginPoints
  const laid = result.pages[index] ?? { lines: [], rules: [] }
  const top = originY + result.headerBand

  for (const rule of laid.rules) {
    const element = document.createElement('div')
    element.className = 'rule'
    element.style.left = `${originX + rule.x}pt`
    element.style.top = `${top + rule.y}pt`
    element.style.width = `${rule.width}pt`
    element.style.height = `${Math.max(0.5, rule.height)}pt`
    page.appendChild(element)
  }

  for (const line of laid.lines) {
    for (const run of line.runs) {
      page.appendChild(drawRun(run.text, run.font, originX + run.x, top + line.y))
    }
  }

  if (settings.showsHeaderAndFooter) {
    drawLetterhead(page, index, result, settings, jobContext, paper)
  }
  return page
}

/**
 * Three slots across the top and three across the bottom, each of them possibly several
 * lines. The header may be limited to the first page; the footer never is, because the thing
 * people put in a footer is the page number.
 */
function drawLetterhead (page, index, result, settings, jobContext, paper) {
  const letterhead = settings.letterhead
  const font = letterheadFont(settings)
  const lineHeight = measure.lineHeight(font)
  const padding = 4
  const left = settings.leftMarginPoints
  const right = paper.width - settings.rightMarginPoints
  const width = right - left

  const resolve = (template) =>
    resolveLetterhead(template, jobContext, index + 1, result.pageCount)

  const printsHeader = hasHeader(letterhead) &&
    (index === 0 || !letterhead.headerOnFirstPageOnly)

  if (printsHeader) {
    drawImage(page, letterhead.headerImage, settings.topMarginPoints + padding, left, width)
    drawBand(page, [letterhead.headerLeft, letterhead.headerCenter, letterhead.headerRight],
      resolve, font, lineHeight, settings.topMarginPoints + padding, left, width)
    if (letterhead.showsRules) {
      drawRule(page, left, settings.topMarginPoints + result.headerBand - padding, width)
    }
  }

  if (!hasFooter(letterhead)) return
  const footerTop = paper.height - settings.bottomMarginPoints - result.footerBand + padding
  drawImage(page, letterhead.footerImage, footerTop, left, width)
  drawBand(page, [letterhead.footerLeft, letterhead.footerCenter, letterhead.footerRight],
    resolve, font, lineHeight, footerTop, left, width)
  if (letterhead.showsRules) drawRule(page, left, footerTop - padding, width)
}

function drawBand (page, slots, resolve, font, lineHeight, top, left, width) {
  slots.forEach((slot, index) => {
    if (!slot) return
    const lines = resolve(slot).split('\n')
    lines.forEach((line, row) => {
      if (!line) return
      const textWidth = measure.width(line, font)
      const x = index === 0 ? left
        : index === 1 ? left + width / 2 - textWidth / 2
          : left + width - textWidth
      page.appendChild(drawRun(line, font, x, top + row * lineHeight))
    })
  })
}

/** At its height, on its side of the band; narrowed to the band's width if it would overrun it. */
function drawImage (page, image, top, left, width) {
  if (!image) return
  let height = imageHeightPoints(image)
  let imageWidth = height * image.aspect
  if (imageWidth > width) { imageWidth = width; height = width / image.aspect }
  const x = image.align === 'center' ? left + (width - imageWidth) / 2
    : image.align === 'right' ? left + width - imageWidth
      : left
  const element = document.createElement('img')
  element.className = 'letterhead-image'
  element.src = image.dataURL
  element.alt = ''
  element.style.left = `${x}pt`
  element.style.top = `${top}pt`
  element.style.width = `${imageWidth}pt`
  element.style.height = `${height}pt`
  page.appendChild(element)
}

function drawRule (page, left, top, width) {
  const element = document.createElement('div')
  element.className = 'rule'
  element.style.left = `${left}pt`
  element.style.top = `${top}pt`
  element.style.width = `${width}pt`
  element.style.height = '0.5pt'
  page.appendChild(element)
}

/**
 * One run, placed where the layout put it. The line box is the font's own natural height, so
 * the text sits at the top of the slot the layout reserved for it — which is what lets double
 * spacing space the *lines* out rather than stretch each one.
 */
function drawRun (text, font, x, y) {
  const element = document.createElement('span')
  element.className = 'run'
  element.textContent = text
  element.style.left = `${x}pt`
  element.style.top = `${y}pt`
  element.style.font = cssFont(font)
  element.style.lineHeight = `${measure.lineHeight(font)}pt`
  return element
}
