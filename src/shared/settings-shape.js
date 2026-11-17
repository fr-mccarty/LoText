// Two bags that never touch. VIEW is the screen; PRINT is paper, and PRINT is a *list* of
// named presets with one of them selected. No value is shared, nothing reads across, and
// margins appear in PRINT and nowhere else in the entire app.
//
// The test: turn the screen text up to 24 and the print text down to 9. The screen gets big,
// the page stays small. Then the other way round. Then set the print font to a serif and check
// the screen is still monospaced.

import { resolveFontChoice } from './print/fonts.js'

// MARK: - View

export const VIEW_FONT_SIZE_RANGE = [8, 36]
export const DEFAULT_VIEW = Object.freeze({
  editorFontSize: 13,
  editorFont: 'systemMono',
  lineSpacing: 'single',
  showInvisibles: false,
  tabSpaces: 2,
  /** Names starting with `.` in the sidebar, Find File and Recently Edited. Off: they are left out. */
  showHiddenFiles: false,
})

/** What Tab puts into the editor. */
export const TAB_SPACES_OPTIONS = [
  { id: 2, label: '2 spaces' },
  { id: 4, label: '4 spaces' },
]

export const LINE_SPACING_OPTIONS = [
  { id: 'single', label: 'Single', multiple: 1.0 },
  { id: 'oneAndAHalf', label: '1.5', multiple: 1.5 },
  { id: 'double', label: 'Double', multiple: 2.0 },
]

export function lineSpacingMultiple (option) {
  return LINE_SPACING_OPTIONS.find((entry) => entry.id === option)?.multiple ?? 1
}

/** Clamps into range, or returns null for a non-finite value so the caller keeps what it had. */
export function clamp (value, [low, high]) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.min(Math.max(number, low), high)
}

export function normalizeView (raw) {
  const view = { ...DEFAULT_VIEW, ...(raw ?? {}) }
  view.editorFontSize = clamp(view.editorFontSize, VIEW_FONT_SIZE_RANGE) ?? DEFAULT_VIEW.editorFontSize
  // The editor lays every line out on one grid, so an unknown or proportional name falls back
  // to the system monospaced font rather than leaving the editor in something it cannot grid.
  view.editorFont = resolveFontChoice(view.editorFont, { monoOnly: true })
  if (!LINE_SPACING_OPTIONS.some((entry) => entry.id === view.lineSpacing)) {
    view.lineSpacing = DEFAULT_VIEW.lineSpacing
  }
  view.showInvisibles = Boolean(view.showInvisibles)
  view.showHiddenFiles = Boolean(view.showHiddenFiles)
  view.tabSpaces = Number(view.tabSpaces) === 4 ? 4 : 2
  return view
}

// MARK: - Print

export const MARGIN_RANGE = [0, 3]
export const PRINT_FONT_SIZE_RANGE = [6, 72]
export const HEADING_MULTIPLIER_RANGE = [0.5, 4.0]
export const HEADING_MULTIPLIER_STEP = 0.05
export const PARAGRAPH_SPACING_RANGE = [0, 48]
export const LETTERHEAD_FONT_SIZE_RANGE = [5, 24]
/** How tall a header or footer image prints, in inches. */
export const LETTERHEAD_IMAGE_HEIGHT_RANGE = [0.1, 3]
export const LETTERHEAD_IMAGE_ALIGNMENTS = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Centre' },
  { id: 'right', label: 'Right' },
]
/**
 * The most an image may weigh, as a data URL. It lives inside the preset, so it goes wherever
 * the preset goes — the settings file, an export, and iCloud — and the panel shrinks what it is
 * given to fit well inside this.
 */
export const LETTERHEAD_IMAGE_MAX_LENGTH = 3_000_000

export const MARGIN_EDGES = [
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
]

export const DEFAULT_HEADING_MULTIPLIERS = [2.0, 1.6, 1.3, 1.15, 1.0, 1.0]

/**
 * What the app printed before presets existed: the file name top left, `page N of M` bottom
 * right. The Default preset carries exactly this, so turning the switch on prints what it
 * always did.
 */
export const STANDARD_LETTERHEAD = Object.freeze({
  headerLeft: '{{file}}',
  headerCenter: '',
  headerRight: '',
  footerLeft: '',
  footerCenter: '',
  footerRight: 'page {{page}} of {{pages}}',
  fontSize: 9,
  font: 'systemSans',
  showsRules: false,
  headerOnFirstPageOnly: false,
  headerImage: null,
  footerImage: null,
})

/** A printed-stationery starting point for a new Letterhead preset. */
export const STATIONERY_LETTERHEAD = Object.freeze({
  headerLeft: '',
  headerCenter: '{{folder}}',
  headerRight: '',
  footerLeft: '{{date}}',
  footerCenter: '',
  footerRight: '{{page}} / {{pages}}',
  fontSize: 9,
  font: 'systemSerif',
  showsRules: true,
  headerOnFirstPageOnly: true,
  headerImage: null,
  footerImage: null,
})

/** Every token the slots understand, for the legend under the fields in Settings. */
export const LETTERHEAD_TOKENS = [
  ['{{file}}', 'the file name'],
  ['{{folder}}', "the opened folder's name"],
  ['{{page}}', "this page's number"],
  ['{{pages}}', 'the total number of pages'],
  ['{{date}}', "today's date"],
  ['{{time}}', 'the time the job was started'],
]

/**
 * The one preset that is always present, always first, and cannot be deleted — there has to be
 * something to print with.
 */
export const DEFAULT_PRESET_ID = '00000000-0000-0000-0000-000000000001'

export function standardPreset (id = DEFAULT_PRESET_ID, name = 'Default') {
  return {
    id,
    name,
    // Which shape Restore Defaults puts back; see PRESET_KINDS.
    kind: 'standard',
    margins: { top: 1.0, bottom: 1.0, left: 1.0, right: 1.0 },
    // The sheet the layout is measured against. macOS takes this from the print panel; here
    // the layout has to know the paper before the panel opens, so the preset carries it and
    // the panel opens already set to it.
    paper: 'letter',
    fontSize: 11,
    uniformTextSize: false,
    headingMultipliers: [...DEFAULT_HEADING_MULTIPLIERS],
    lineSpacing: 'single',
    paragraphSpacing: 6,
    bodyFont: 'times',
    headingFont: 'times',
    showsHeaderAndFooter: false,
    letterhead: { ...STANDARD_LETTERHEAD, font: 'times' },
  }
}

/**
 * The other shapes a new preset can start from. "Add a layout type" is this list plus
 * "duplicate what I have open".
 */
export const PRESET_KINDS = [
  { id: 'standard', label: 'Standard', summary: 'One-inch margins, Times New Roman, eleven point.' },
  { id: 'presentation', label: 'Presentation Script', summary: 'Three-quarter-inch margins, twenty-two point, to read aloud.' },
  { id: 'formal', label: 'Formal Document', summary: 'One-inch margins, twelve point Times New Roman.' },
  { id: 'letterhead', label: 'Letterhead', summary: 'One-inch margins, twelve point, a ruled header and footer.' },
  { id: 'manuscript', label: 'Manuscript', summary: 'Double spaced, twelve point serif, page numbers.' },
  { id: 'compact', label: 'Compact', summary: 'Half-inch margins, nine point, tight spacing.' },
]

/**
 * The presets a new install starts with, after Default. Their ids are fixed so that a Mac and
 * an iPhone that each add them to settings they already had end up with one of each after
 * iCloud sync, not two.
 */
export const BUILT_IN_PRESETS = [
  { id: '00000000-0000-0000-0000-000000000002', kind: 'presentation', name: 'Presentation Script' },
  { id: '00000000-0000-0000-0000-000000000003', kind: 'formal', name: 'Formal Document' },
  { id: '00000000-0000-0000-0000-000000000004', kind: 'letterhead', name: 'Letterhead' },
]

/** Default and the built-in presets, as a fresh install has them. */
export function builtInPresets () {
  return [standardPreset(),
    ...BUILT_IN_PRESETS.map((entry) => makePreset(entry.kind, entry.name, entry.id))]
}

/** A fresh preset of `kind`, with a new identity. The name is the caller's to make unique. */
export function makePreset (kind, name, id) {
  const preset = standardPreset(id, name)
  preset.kind = PRESET_KINDS.some((entry) => entry.id === kind) ? kind : 'standard'
  switch (kind) {
    case 'presentation':
      preset.margins = { top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 }
      preset.fontSize = 22
      preset.paragraphSpacing = 11
      // Twice 22 point is a poster, not a heading: a script's headings only need to stand out.
      preset.headingMultipliers = [1.3, 1.2, 1.1, 1.0, 1.0, 1.0]
      break
    case 'formal':
      preset.fontSize = 12
      break
    case 'letterhead':
      preset.fontSize = 12
      preset.paragraphSpacing = 8
      preset.showsHeaderAndFooter = true
      preset.letterhead = { ...STATIONERY_LETTERHEAD, font: 'times' }
      break
    case 'manuscript':
      preset.fontSize = 12
      preset.lineSpacing = 'double'
      preset.paragraphSpacing = 0
      preset.headingMultipliers = [1, 1, 1, 1, 1, 1]
      preset.showsHeaderAndFooter = true
      preset.letterhead = {
        headerLeft: '', headerCenter: '', headerRight: '',
        footerLeft: '', footerCenter: '{{page}}', footerRight: '',
        fontSize: 10, font: 'times', showsRules: false, headerOnFirstPageOnly: false,
        headerImage: null, footerImage: null,
      }
      break
    case 'compact':
      preset.margins = { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
      preset.fontSize = 9
      preset.paragraphSpacing = 3
      preset.headingMultipliers = [1.5, 1.3, 1.15, 1.0, 1.0, 1.0]
      break
    default:
      break
  }
  return preset
}

/** Clamps to 0.5…4.0 and snaps to the documented 0.05 step. */
export function snapMultiplier (value) {
  const clamped = clamp(value, HEADING_MULTIPLIER_RANGE)
  if (clamped === null) return null
  return Math.round(clamped * 20) / 20
}

/**
 * Repairs a decoded preset: a settings file edited by hand, or written by a future version
 * with a different idea of how many headings there are, must not be able to crash an array
 * index later on. Decoding tolerates a preset written before a field existed, so an older
 * file keeps every value it does have instead of being thrown away whole.
 */
export function normalizePreset (raw, id) {
  const fallback = standardPreset(id ?? raw?.id ?? DEFAULT_PRESET_ID, 'Untitled')
  const preset = { ...fallback, ...(raw ?? {}) }
  preset.id = raw?.id ?? fallback.id
  preset.name = String(preset.name ?? '').trim() || 'Untitled'
  if (!PRESET_KINDS.some((entry) => entry.id === preset.kind)) preset.kind = 'standard'

  const margins = { ...fallback.margins, ...(raw?.margins ?? {}) }
  preset.margins = {}
  for (const edge of MARGIN_EDGES) {
    preset.margins[edge.key] = clamp(margins[edge.key], MARGIN_RANGE) ?? 1.0
  }

  preset.headingMultipliers = Array.from({ length: 6 }, (_, index) => {
    const raw2 = preset.headingMultipliers?.[index]
    return snapMultiplier(raw2) ?? DEFAULT_HEADING_MULTIPLIERS[index]
  })
  preset.fontSize = clamp(preset.fontSize, PRINT_FONT_SIZE_RANGE) ?? 11
  preset.paragraphSpacing = clamp(preset.paragraphSpacing, PARAGRAPH_SPACING_RANGE) ?? 6
  preset.uniformTextSize = Boolean(preset.uniformTextSize)
  if (!Object.prototype.hasOwnProperty.call(PAPER_SIZES, preset.paper)) preset.paper = 'letter'
  preset.showsHeaderAndFooter = Boolean(preset.showsHeaderAndFooter)
  if (!LINE_SPACING_OPTIONS.some((entry) => entry.id === preset.lineSpacing)) {
    preset.lineSpacing = 'single'
  }
  preset.bodyFont = resolveFontChoice(preset.bodyFont)
  preset.headingFont = resolveFontChoice(preset.headingFont)

  const letterhead = { ...STANDARD_LETTERHEAD, ...(preset.letterhead ?? {}) }
  letterhead.fontSize = clamp(letterhead.fontSize, LETTERHEAD_FONT_SIZE_RANGE) ?? 9
  letterhead.font = resolveFontChoice(letterhead.font)
  for (const slot of ['headerLeft', 'headerCenter', 'headerRight',
    'footerLeft', 'footerCenter', 'footerRight']) {
    letterhead[slot] = String(letterhead[slot] ?? '')
  }
  letterhead.showsRules = Boolean(letterhead.showsRules)
  letterhead.headerOnFirstPageOnly = Boolean(letterhead.headerOnFirstPageOnly)
  letterhead.headerImage = normalizeLetterheadImage(letterhead.headerImage)
  letterhead.footerImage = normalizeLetterheadImage(letterhead.footerImage)
  preset.letterhead = letterhead

  return preset
}

/**
 * A logo in the header or a line of small print as a picture in the footer: the image itself as a
 * data URL, its shape (width over height), how tall it prints, and which side it sits on.
 * Anything that is not a usable image is no image, rather than a broken one on the page.
 */
export function normalizeLetterheadImage (raw) {
  if (!raw || typeof raw !== 'object') return null
  const dataURL = typeof raw.dataURL === 'string' ? raw.dataURL : ''
  if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(dataURL)) return null
  if (dataURL.length > LETTERHEAD_IMAGE_MAX_LENGTH) return null
  const aspect = Number(raw.aspect)
  if (!Number.isFinite(aspect) || aspect <= 0) return null
  return {
    dataURL,
    aspect,
    height: clamp(raw.height, LETTERHEAD_IMAGE_HEIGHT_RANGE) ?? 0.75,
    align: LETTERHEAD_IMAGE_ALIGNMENTS.some((entry) => entry.id === raw.align) ? raw.align : 'left',
    name: String(raw.name ?? ''),
  }
}

/**
 * A plain value copy of one preset, in the shape the layout and the renderer both read:
 * margins already in points, line spacing already a multiple. Nothing is ever written back.
 */
export const POINTS_PER_INCH = 72

export function snapshot (preset) {
  return {
    presetName: preset.name,
    paper: preset.paper,
    marginTop: preset.margins.top,
    marginBottom: preset.margins.bottom,
    marginLeft: preset.margins.left,
    marginRight: preset.margins.right,
    topMarginPoints: preset.margins.top * POINTS_PER_INCH,
    bottomMarginPoints: preset.margins.bottom * POINTS_PER_INCH,
    leftMarginPoints: preset.margins.left * POINTS_PER_INCH,
    rightMarginPoints: preset.margins.right * POINTS_PER_INCH,
    fontSize: preset.fontSize,
    uniformTextSize: preset.uniformTextSize,
    headingMultipliers: preset.headingMultipliers,
    lineSpacingMultiple: lineSpacingMultiple(preset.lineSpacing),
    paragraphSpacing: preset.paragraphSpacing,
    bodyFont: preset.bodyFont,
    headingFont: preset.headingFont,
    showsHeaderAndFooter: preset.showsHeaderAndFooter,
    letterhead: preset.letterhead,
  }
}

/** The paper a job may ask for, in points, portrait. */
export const PAPER_SIZES = {
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
  a4: { width: 595, height: 842 },
  a5: { width: 420, height: 595 },
}
