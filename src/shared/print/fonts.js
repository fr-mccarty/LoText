// Fonts and metrics for the printed page. Measuring and drawing go through the same
// description so a line that was laid out to fit cannot overflow when drawn.

import { BOLD, ITALIC, CODE } from '../markdown/blocks.js'

/**
 * The font families the app offers, on screen and on paper. A short curated list rather than
 * the whole font book: every entry ships with the system, so a preset made on one machine
 * prints the same on another, and a name that has somehow gone missing falls back to a face
 * of the same kind instead of silently printing in something else.
 *
 * Used independently by the view settings (the editor) and by each print preset (paper). The
 * two never share a stored value — picking Georgia for print leaves the editor as it was.
 */
export const FONT_CHOICES = {
  // Monospaced — the editor's whole list, and the default on paper.
  systemMono: { label: 'System Monospaced', mono: true, css: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace' },
  sfMono: { label: 'SF Mono', mono: true, css: '"SF Mono", ui-monospace, Menlo, Consolas, monospace' },
  menlo: { label: 'Menlo', mono: true, css: 'Menlo, ui-monospace, Consolas, monospace' },
  courier: { label: 'Courier New', mono: true, css: '"Courier New", Courier, monospace' },

  // Proportional — printing only, for anything meant to read like a document.
  systemSans: { label: 'System Sans', mono: false, css: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' },
  systemSerif: { label: 'System Serif', mono: false, css: 'ui-serif, "New York", Georgia, serif' },
  helvetica: { label: 'Helvetica Neue', mono: false, css: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  times: { label: 'Times New Roman', mono: false, css: '"Times New Roman", Times, serif' },
  georgia: { label: 'Georgia', mono: false, css: 'Georgia, serif' },
  palatino: { label: 'Palatino', mono: false, css: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
}

export const DEFAULT_FONT = 'systemMono'

/**
 * What the editor may be set to. The editor lays every line out on one uniform grid and marks
 * invisibles against it, so a proportional face there would be a different app.
 */
export const EDITOR_FONT_CHOICES =
  Object.keys(FONT_CHOICES).filter((key) => FONT_CHOICES[key].mono)

export const PRINT_FONT_CHOICES = Object.keys(FONT_CHOICES)

/** A stored name that is unknown, or names a proportional face where one is not allowed. */
export function resolveFontChoice (name, { monoOnly = false } = {}) {
  const choice = FONT_CHOICES[name]
  if (!choice) return DEFAULT_FONT
  if (monoOnly && !choice.mono) return DEFAULT_FONT
  return name
}

/** A font as a plain value: what to measure with, and what to draw with. */
export function makeFont (choice, size, { bold = false, italic = false } = {}) {
  return { choice: resolveFontChoice(choice), size: Math.max(1, size), bold, italic }
}

/**
 * The one place an inline style becomes a font: `code` forces monospaced, and bold and italic
 * are asked of whichever face is in play. A family without a real italic — most monospaced
 * faces — is slanted by the text engine rather than left upright, so `*emphasis*` is visibly
 * emphasis on the page instead of quietly printing the same as the text around it.
 */
export function styledFont (choice, size, style) {
  const face = (style & CODE) ? 'systemMono' : choice
  return makeFont(face, size, { bold: Boolean(style & BOLD), italic: Boolean(style & ITALIC) })
}

/** Body text in the preset's body face, at the preset's size, carrying the run's style. */
export function bodyFont (settings, style = 0) {
  return styledFont(settings.bodyFont, settings.fontSize, style)
}

/**
 * Bold at multiplier × body size, in the preset's heading face — unless uniform text size is
 * on, in which case a heading is drawn exactly like body text (only its hashes are gone). A
 * heading is bold by default, so an inline `**` inside one changes nothing.
 */
export function headingFont (level, settings, style = 0) {
  if (settings.uniformTextSize) return bodyFont(settings, style)
  return styledFont(settings.headingFont, headingPointSize(settings, level), style | BOLD)
}

export function letterheadFont (settings, style = 0) {
  return styledFont(settings.letterhead.font, settings.letterhead.fontSize, style)
}

/** The point size a heading of `level` prints at. */
export function headingPointSize (settings, level) {
  if (settings.uniformTextSize) return settings.fontSize
  const multipliers = settings.headingMultipliers
  if (level < 1 || level > multipliers.length) return settings.fontSize
  return settings.fontSize * multipliers[level - 1]
}

/** The CSS shorthand a canvas and a page both take. */
export function cssFont (font) {
  const style = font.italic ? 'italic ' : ''
  const weight = font.bold ? '700 ' : '400 '
  return `${style}${weight}${font.size}pt ${FONT_CHOICES[font.choice].css}`
}

export function fontKey (font) {
  return `${font.choice}|${font.size}|${font.bold ? 1 : 0}|${font.italic ? 1 : 0}`
}

/**
 * Canvas answers in CSS pixels; the layout works entirely in points, as do the `pt` units the
 * page is drawn with. CSS fixes 1in = 96px and 1pt = 1/72in, so the two differ by a constant
 * 4/3 and a measurement that is not converted places every run on a line 33% too far right.
 */
export const POINTS_PER_PIXEL = 72 / 96

export function pixelsToPoints (pixels) {
  return pixels * POINTS_PER_PIXEL
}
