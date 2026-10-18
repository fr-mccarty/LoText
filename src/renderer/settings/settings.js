// The Settings panel (⌘,): two tabs, **View** and **Printing**, and they are fully independent.
// No value is shared between them, no control on one reads or writes the other's storage, and
// changing anything on one tab leaves everything on the other visibly unchanged.
//
// The test: turn the screen text up to 24 and the print text down to 9. The screen gets big,
// the page stays small. Then the other way round. Then set the print font to a serif and check
// the screen is still monospaced.
//
// Everything below the preset picker edits *the selected preset*. Switching preset switches
// every field on the tab, which is the whole point of there being presets: a letterhead and a
// manuscript are two sets of these values, not two apps.

import { element, clear, icon } from '../dom.js'
import {
  VIEW_FONT_SIZE_RANGE, MARGIN_RANGE, PRINT_FONT_SIZE_RANGE, HEADING_MULTIPLIER_RANGE,
  HEADING_MULTIPLIER_STEP, PARAGRAPH_SPACING_RANGE, LETTERHEAD_FONT_SIZE_RANGE,
  LINE_SPACING_OPTIONS, TAB_SPACES_OPTIONS, MARGIN_EDGES, PRESET_KINDS, LETTERHEAD_TOKENS,
  DEFAULT_PRESET_ID, LETTERHEAD_IMAGE_HEIGHT_RANGE, LETTERHEAD_IMAGE_ALIGNMENTS,
  LETTERHEAD_IMAGE_MAX_LENGTH,
} from '../../shared/settings-shape.js'
import { restoringErrors } from '../bridge-errors.js'
import { FONT_CHOICES, EDITOR_FONT_CHOICES, PRINT_FONT_CHOICES } from '../../shared/print/fonts.js'
import { keys, words, markPlatform } from '../platform.js'

const bridge = restoringErrors(window.lotext)
markPlatform()
const tabsNode = document.getElementById('tabs')
const titleNode = document.getElementById('window-title')
const panelNode = document.getElementById('panel')

const TABS = [['view', 'Editor', 'textSize'], ['print', 'Printing', 'printer']]

let settings = null
/** iCloud sync's switch and what it is doing, from `cloudStatus` (src/shared/sync/cloud-sync.js). */
let cloud = null
let tab = 'view'
/** Where each tab was scrolled to, so coming back to one finds it where it was left. */
const scrolled = { view: 0, print: 0 }
/** The tab the panel is showing now; a redraw of the same tab keeps its live scroll position. */
let renderedTab = null

bridge.onSettingsChanged((state) => { settings = state; render() })
bridge.readSettings().then((state) => { settings = state; render() })
bridge.onCloudStatus?.((status) => { cloud = status; render() })
bridge.cloudStatus?.().then((status) => { cloud = status; render() }).catch(() => {})

function render () {
  if (!settings) return
  clear(tabsNode)
  for (const [id, label, glyph] of TABS) {
    tabsNode.append(element('button', {
      class: `tab${tab === id ? ' active' : ''}`,
      onclick: () => { scrolled[tab] = panelNode.scrollTop; tab = id; render() },
    }, [icon(glyph, 22), element('span', { text: label })]))
  }
  // The window is named after the tab, not after the panel: the tab bar and the title say the
  // same word, so the window in the Window menu is the one being looked at.
  //
  // It is said twice because macOS paints no title on a `hiddenInset` window: the drawn one is
  // what anybody looking at the window reads, and `setSettingsTitle` is what the Window menu
  // and the window list read. One expression feeds both, so they cannot disagree.
  const title = TABS.find(([id]) => id === tab)[1]
  titleNode.textContent = title
  bridge.setSettingsTitle(title)
  // Every change redraws the tab, and emptying the panel clamps its scroll to the top — so a
  // margin changed halfway down Printing threw the panel back to the top, twice, once for the
  // answer and once for the broadcast. The position is taken before and put back after.
  const top = tab === renderedTab ? panelNode.scrollTop : scrolled[tab]
  clear(panelNode)
  panelNode.append(tab === 'view' ? viewTab() : printTab())
  panelNode.scrollTop = top
  renderedTab = tab
}

async function apply (promise) {
  settings = await promise
  render()
}

// MARK: - Small controls

/**
 * One titled section: the heading sits above the card and the footnote below it, so the card
 * holds rows and nothing else. Both are optional, and a section with neither is just the card.
 */
function group (title, children, footnote) {
  return element('section', { class: 'group-wrap' }, [
    title ? element('h2', { text: title }) : null,
    element('div', { class: 'group' }, [].concat(children).filter(Boolean)),
    footnote ? element('div', { class: 'footnote' }, [].concat(footnote)) : null,
  ])
}

function field (label, control, { caption, captionClass = '', disabled } = {}) {
  return element('div', { class: `field${disabled ? ' disabled' : ''}` }, [
    element('label', { text: label }),
    control,
    caption ? element('span', { class: `caption ${captionClass}`.trim(), text: caption }) : null,
  ])
}

/**
 * One numeric row: a field to type into and a stepper beside it. The settings objects clamp on
 * set, so neither control can push a value out of range.
 *
 * `digits` is a *maximum*, not a width — a one-inch margin reads `1`, and the quarter-inch it
 * steps to reads `1.25`. A margin that always showed `1.00` would be claiming a precision the
 * page does not have.
 *
 * The stepper is drawn rather than left to `type=number`, whose own spin buttons appear only
 * under the pointer and are half the height of the pair macOS puts beside a field.
 */
function numberField (value, [low, high], step, onChange, digits = 0) {
  const input = element('input', {
    type: 'number',
    value: round(value, digits),
    min: low,
    max: high,
    step,
  })
  const commit = () => {
    const next = Number(input.value)
    if (Number.isFinite(next)) onChange(next)
  }
  input.addEventListener('change', commit)
  input.addEventListener('blur', commit)
  // Stepping 0.05 at a time in binary lands on 1.2000000000000002, which would then be stored
  // and printed; the step's own precision is as much as anybody asked for.
  const nudge = (direction) => () => onChange(Number((Number(input.value) + direction * step).toFixed(4)))
  return element('div', { class: 'stepper-field' }, [
    input,
    element('div', { class: 'stepper' }, [
      element('button', { class: 'up', title: 'Increase', onclick: nudge(1) }, [icon('chevronUp', 22)]),
      element('button', { class: 'down', title: 'Decrease', onclick: nudge(-1) }, [icon('chevronDown', 22)]),
    ]),
  ])
}

function picker (choices, selected, onChange) {
  const select = element('select', { onchange: (event) => onChange(event.target.value) })
  for (const [value, label] of choices) {
    const option = element('option', { value, text: label })
    if (value === selected) option.selected = true
    select.append(option)
  }
  return popup(select, choices.find(([value]) => value === selected)?.[1] ?? '')
}

/**
 * A popup button, drawn over a real `<select>`. The select is still the control — the menu, the
 * keyboard and the accessibility tree are all the browser's — but it is invisible, so what shows
 * is the value in plain text beside a chevron rather than a boxed web widget on a light face.
 *
 * A pull-down (`Add Layout…`) keeps its own label instead of showing a value, and gets the
 * one-way chevron that says so.
 */
function popup (select, label, pull = false) {
  return element('div', { class: `popup${pull ? ' pull' : ''}` }, [
    element('span', { class: 'popup-value', text: label }),
    element('span', { class: 'popup-chevron' }, [icon(pull ? 'chevronDown' : 'chevronUpDown', 20)]),
    select,
  ])
}

function segmented (options, selected, onChange) {
  return element('div', { class: 'segmented' }, options.map(([value, label]) =>
    element('button', {
      class: value === selected ? 'active' : '',
      text: label,
      onclick: () => onChange(value),
    })))
}

/** A switch rather than a checkbox: the row states a setting, and a switch says which way. */
function toggle (label, checked, onChange, disabled) {
  const box = element('input', {
    type: 'checkbox',
    class: 'switch',
    onchange: (event) => onChange(event.target.checked),
  })
  box.checked = checked
  return element('div', { class: `field${disabled ? ' disabled' : ''}` }, [
    element('label', { text: label }),
    box,
  ])
}

const fontOptions = (keys) => keys.map((key) => [key, FONT_CHOICES[key].label])
const spacingOptions = LINE_SPACING_OPTIONS.map((option) => [option.id, option.label])
const tabOptions = TAB_SPACES_OPTIONS.map((option) => [option.id, option.label])

// MARK: - The settings file

/**
 * Import and export, on both tabs.
 *
 * It is the same section in both places because it is not a *tab's* setting: one file carries
 * the editor bag, the printing bag and every preset. Putting it on one tab only would hide half
 * the app's settings behind the other tab's name, and the footnote says as much so nobody has
 * to guess which half they are about to overwrite.
 */
function settingsFileSection () {
  const note = element('span', {
    text: 'One JSON file holding both tabs and every print preset. Importing replaces all of '
      + 'them.',
  })

  const say = (message, isError) => {
    clear(note)
    note.append(element('span', { class: isError ? 'warn' : '', text: message }))
  }

  return group('Settings File', [
    element('div', { class: 'row-buttons' }, [
      element('button', {
        class: 'plain',
        text: 'Export\u2026',
        title: 'Write every setting to a JSON file',
        onclick: async () => {
          const result = await bridge.exportSettings()
          if (result.canceled) return
          say(result.ok ? `Exported to ${result.name}.` : result.reason, !result.ok)
        },
      }),
      element('button', {
        class: 'plain',
        text: 'Import\u2026',
        title: 'Replace every setting with the contents of a JSON file',
        onclick: async () => {
          const result = await bridge.importSettings()
          if (result.canceled) return
          if (!result.ok) { say(result.reason, true); return }
          // The panel redraws from what the import wrote, so what is on screen is what is
          // stored rather than what was there a moment ago.
          settings = result.settings
          render()
          say(`Imported ${result.presets} preset${result.presets === 1 ? '' : 's'} from ${result.name}.`)
        },
      }),
      element('span', { class: 'spacer' }),
    ]),
  ], note)
}

// MARK: - iCloud

/**
 * On both tabs, like the settings file and for the same reason: it carries both tabs' settings.
 * Optional and off until turned on; the footnote says what it is doing.
 */
function cloudSection () {
  if (!cloud) return null
  return group('iCloud', [
    toggle('Sync settings and reading positions', cloud.enabled, async (value) => {
      cloud = { ...cloud, enabled: value, state: value ? 'checking' : 'off' }
      render()
      cloud = await bridge.setCloudSync(value)
      render()
    }),
  ], cloudFootnote())
}

function cloudFootnote () {
  const what = 'Keeps both tabs\u2019 settings, the print presets, and the place you left each '
    + 'document in iCloud, so this device and your others share them. Positions travel for '
    + 'documents in iCloud Drive.'
  if (!cloud.enabled) {
    return element('span', {
      text: `${what} Turning it on takes the settings already in iCloud, if another device put `
        + 'them there.',
    })
  }
  if (cloud.state === 'checking') return element('span', { text: 'Checking iCloud\u2026' })
  if (cloud.state === 'unavailable' || cloud.state === 'failed') {
    return element('span', { class: 'warn', text: cloud.message ?? 'iCloud is not available.' })
  }
  const devices = [...new Set(cloud.devices ?? [])]
  return element('span', {
    text: devices.length
      ? `On. Shared with ${devices.join(', ')}.`
      : 'On. No other device has synced yet.',
  })
}

// MARK: - The View tab

/** Affects only what is on screen. Reads and writes the view bag only. */
function viewTab () {
  const view = settings.view
  return element('div', {}, [
    group('Editor Text', [
      field('Font', picker(fontOptions(EDITOR_FONT_CHOICES), view.editorFont,
        (value) => apply(bridge.setView({ editorFont: value })))),
      field('Font size',
        numberField(view.editorFontSize, VIEW_FONT_SIZE_RANGE, 1,
          (value) => apply(bridge.setView({ editorFontSize: value }))),
        { caption: 'pt' }),
      field('Line spacing', segmented(spacingOptions, view.lineSpacing,
        (value) => apply(bridge.setView({ lineSpacing: value })))),
      field('Tab inserts', segmented(tabOptions, view.tabSpaces,
        (value) => apply(bridge.setView({ tabSpaces: value })))),
    ]),
    group(null, [
      toggle('Show invisibles (spaces and tabs)', view.showInvisibles,
        (value) => apply(bridge.setView({ showInvisibles: value }))),
    ], element('span', {
      text: 'These settings change the editor only, and the font list is monospaced because '
        + 'every line here is laid out on one grid. Paper and PDF output, including its own '
        + 'fonts, is on the Printing tab.',
    })),
    group(null, [
      element('div', { class: 'row-buttons' }, [
        element('span', { class: 'spacer' }),
        element('button', {
          class: 'plain',
          text: 'Restore Defaults',
          title: 'Restore every view setting to its default',
          onclick: () => apply(bridge.restoreViewDefaults()),
        }),
      ]),
    ]),
    dayCapSection(),
    settingsFileSection(),
    cloudSection(),
  ])
}

/**
 * The folder Cut and Send to DayCap saves into. It is each device's own, kept outside the
 * settings bags, so it is read and chosen through calls of its own: a path on the Mac, a folder
 * picked in Files on the iPhone and iPad.
 */
function dayCapSection () {
  if (!bridge.sendsToDayCap) return null
  const onPhone = bridge.platform === 'ios'
  const shown = element('span', { class: 'caption daycap-folder' })
  const show = (folder) => {
    // Marks on both sides keep the path reading left to right inside a box that trims its start.
    shown.textContent = folder ? `\u200e${folder}\u200e` : 'Not chosen'
    shown.title = folder ?? ''
  }
  show(null)
  bridge.dayCapFolder().then(show, () => {})
  return group('DayCap', [
    field('Folder', element('div', { class: 'row-buttons' }, [
      shown,
      element('button', {
        class: 'plain',
        text: 'Choose\u2026',
        title: 'Choose the folder DayCap drops its files into',
        onclick: async () => {
          const folder = await bridge.chooseDayCapFolder()
          if (folder) show(folder)
        },
      }),
    ])),
  ], element('span', {
    text: `Cut and Send to DayCap, in the editor\u2019s ${onPhone ? '\u22ef' : 'right-click'} menu, `
      + 'saves the selected text as a new .md file in this folder. The folder belongs to this '
      + `${onPhone ? 'device' : words.computer}: it is not synced or exported, and Restore Defaults leaves `
      + 'it as it is.',
  }))
}

// MARK: - The Printing tab

/** Affects only paper and PDF output, and is the one place in the app where margins appear. */
function printTab () {
  const preset = settings.presets.find((item) => item.id === settings.activePresetID)
  const patch = (changes) => apply(bridge.updatePreset(changes))
  const uniform = preset.uniformTextSize

  return element('div', {}, [
    presetSection(preset),
    // Four edges and nothing else. Paper is not a setting here: the system print panel has its
    // own paper menu and the preset's value only seeds it, so a picker in this card would be a
    // second place to say the same thing — and the one place that has to ask, the command
    // line, already asks with `--paper`.
    group('Margins', MARGIN_EDGES.map((edge) => field(edge.label,
      numberField(preset.margins[edge.key], MARGIN_RANGE, 0.25,
        (value) => patch({ margins: { ...preset.margins, [edge.key]: value } }), 2),
      { caption: 'in' }))),
    group('Printed Text', [
      field('Body font', picker(fontOptions(PRINT_FONT_CHOICES), preset.bodyFont,
        (value) => patch({ bodyFont: value }))),
      field('Heading font', picker(fontOptions(PRINT_FONT_CHOICES), preset.headingFont,
        (value) => patch({ headingFont: value })), { disabled: uniform }),
      field('Print font size',
        numberField(preset.fontSize, PRINT_FONT_SIZE_RANGE, 1,
          (value) => patch({ fontSize: value })),
        { caption: 'pt' }),
      toggle('Print all text at the same size', uniform,
        (value) => patch({ uniformTextSize: value })),
    ], element('span', {
      text: '**bold**, *italic* and `code` print as bold, italic and monospaced. Pipe tables '
        + 'print as ruled tables. The editor shows all of it as the text you typed.',
    })),
    // When "print all text at the same size" is on these rows are merely disabled — their
    // stored values are never zeroed or rewritten, so unchecking the box brings them back
    // exactly as they were.
    group('Heading Sizes', [1, 2, 3, 4, 5, 6].map((level) => field(`Heading ${level}`,
      numberField(preset.headingMultipliers[level - 1], HEADING_MULTIPLIER_RANGE,
        HEADING_MULTIPLIER_STEP, (value) => {
          const next = [...preset.headingMultipliers]
          next[level - 1] = value
          patch({ headingMultipliers: next })
        }, 2),
      {
        // The live resulting size: 11 pt body × 2.0 reads "= 22 pt".
        caption: `= ${trim(preset.fontSize * preset.headingMultipliers[level - 1])} pt`,
        captionClass: 'result',
        disabled: uniform,
      })),
    element('span', {
      text: 'Each heading is a multiple of the print font size. These values are kept while '
        + '“Print all text at the same size” is on.',
    })),
    group('Spacing', [
      field('Line spacing', segmented(spacingOptions, preset.lineSpacing,
        (value) => patch({ lineSpacing: value }))),
      field('Paragraph spacing',
        numberField(preset.paragraphSpacing, PARAGRAPH_SPACING_RANGE, 1,
          (value) => patch({ paragraphSpacing: value })),
        { caption: 'pt' }),
    ]),
    letterheadSection(preset, patch),
    group(null, [
      element('div', { class: 'row-buttons' }, [
        element('span', { class: 'spacer' }),
        element('button', {
          class: 'plain',
          text: 'Restore Defaults',
          title: "Restore this preset's settings to their defaults. Other presets are untouched.",
          onclick: () => apply(bridge.restorePrintDefaults()),
        }),
      ]),
    ]),
    settingsFileSection(),
    cloudSection(),
  ])
}

/**
 * A preset's *name* is its handle: it is what this tab shows, and what `--preset` asks for on
 * the command line. The Default preset always stays, so there is always something to print with.
 */
function presetSection (preset) {
  const canDelete = preset.id !== DEFAULT_PRESET_ID && settings.presets.length > 1
  const kindMenu = popup(element('select', {
    onchange: (event) => {
      const kind = event.target.value
      event.target.value = ''
      if (kind) apply(bridge.addPreset(kind))
    },
  }, [element('option', { value: '', text: 'Add Layout…' }),
    ...PRESET_KINDS.map((kind) =>
      element('option', { value: kind.id, text: `${kind.label} — ${kind.summary}` }))]),
  'Add Layout…', true)

  return group('Layout Preset', [
    field('Layout preset', picker(settings.presets.map((item) => [item.id, item.name]),
      settings.activePresetID, (value) => apply(bridge.selectPreset(value)))),
    element('div', { class: 'row-buttons' }, [
      kindMenu,
      element('button', {
        class: 'plain',
        text: 'Duplicate',
        title: 'Copy this preset, and edit the copy',
        onclick: () => apply(bridge.duplicatePreset()),
      }),
      element('button', {
        class: 'plain',
        text: 'Rename…',
        onclick: () => {
          const name = window.prompt('Name this preset', preset.name)
          if (name) apply(bridge.renamePreset(name))
        },
      }),
      element('span', { class: 'spacer' }),
      element('button', {
        class: 'plain destructive',
        text: 'Delete',
        disabled: !canDelete,
        title: canDelete
          ? 'Delete this preset'
          : 'The Default preset stays, so there is always something to print with',
        onclick: () => apply(bridge.deletePreset()),
      }),
    ]),
  ], element('span', {
    // iOS has no command line, and its Print… is in a menu rather than on ⌘P.
    text: bridge.platform === 'ios'
      ? 'Every setting below belongs to the selected preset. Print… and Share PDF… use it.'
      : keys('Every setting below belongs to the selected preset. ⌘P uses it, and so does ')
        + 'lotext --pdf unless --preset names another.',
  }))
}

/**
 * Six slots of text, three along the top of the page and three along the bottom. The fields
 * stay visible and merely disabled when the letterhead is switched off, so what a preset would
 * print is always readable without having to turn it on to find out.
 */
function letterheadSection (preset, patch) {
  const letterhead = preset.letterhead
  const off = !preset.showsHeaderAndFooter
  const set = (changes) => patch({ letterhead: { ...letterhead, ...changes } })

  // A slot may hold several lines — an address block in the top right is the reason this is
  // not a single-line field. Empty slots take no space on the page at all.
  const slot = (label, key) => {
    const box = element('textarea', { rows: '1' })
    box.value = letterhead[key]
    box.addEventListener('change', () => set({ [key]: box.value }))
    box.addEventListener('blur', () => set({ [key]: box.value }))
    return field(label, box, { disabled: off })
  }

  return group('Letterhead', [
    toggle('Print letterhead header and footer', preset.showsHeaderAndFooter,
      (value) => patch({ showsHeaderAndFooter: value })),
    slot('Header left', 'headerLeft'),
    slot('Header centre', 'headerCenter'),
    slot('Header right', 'headerRight'),
    slot('Footer left', 'footerLeft'),
    slot('Footer centre', 'footerCenter'),
    slot('Footer right', 'footerRight'),
    ...letterheadImage('Header image', letterhead.headerImage, (image) => set({ headerImage: image }), off),
    ...letterheadImage('Footer image', letterhead.footerImage, (image) => set({ footerImage: image }), off),
    field('Letterhead font', picker(fontOptions(PRINT_FONT_CHOICES), letterhead.font,
      (value) => set({ font: value })), { disabled: off }),
    field('Letterhead size',
      numberField(letterhead.fontSize, LETTERHEAD_FONT_SIZE_RANGE, 1,
        (value) => set({ fontSize: value })),
      { caption: 'pt', disabled: off }),
    toggle('Rule under the header and above the footer', letterhead.showsRules,
      (value) => set({ showsRules: value }), off),
    // Letterhead convention: the printed sheet on page one, nothing on the pages after it. The
    // footer is unaffected — page numbers are wanted on every page.
    toggle('Header on the first page only', letterhead.headerOnFirstPageOnly,
      (value) => set({ headerOnFirstPageOnly: value }), off),
  ], element('div', { class: 'token-legend' }, [
    element('div', { text: 'Each slot may hold several lines. These stand in for what the page knows:' }),
    ...LETTERHEAD_TOKENS.map(([token, meaning]) =>
      element('div', {}, [element('code', { text: token }), element('span', { text: ` — ${meaning}` })])),
  ]))
}

// MARK: - Letterhead images

/**
 * A picture in the header or footer — a logo, a signature, a line of stationery. It is stored in
 * the preset itself, so it goes wherever the preset goes: the settings file, and iCloud.
 */
function letterheadImage (label, image, change, disabled) {
  const choose = (title) => element('button', {
    class: 'plain',
    text: title,
    disabled,
    onclick: async () => {
      const file = await pickImageFile()
      if (!file) return
      try {
        const prepared = await prepareImage(file)
        change({ ...prepared, height: image?.height ?? 0.75, align: image?.align ?? 'left' })
      } catch (error) {
        window.alert(`That image could not be used. ${error.message}`)
      }
    },
  })

  if (!image) {
    return [field(label, element('div', { class: 'row-buttons' }, [choose('Choose\u2026')]), { disabled })]
  }
  return [
    field(label, element('div', { class: 'row-buttons' }, [
      element('img', { class: 'letterhead-thumb', src: image.dataURL, alt: image.name, title: image.name }),
      choose('Replace\u2026'),
      element('button', { class: 'plain', text: 'Remove', disabled, onclick: () => change(null) }),
    ]), { disabled }),
    field(`${label} height`,
      numberField(image.height, LETTERHEAD_IMAGE_HEIGHT_RANGE, 0.05,
        (value) => change({ ...image, height: value }), 2),
      { caption: 'in', disabled }),
    field(`${label} position`, segmented(
      LETTERHEAD_IMAGE_ALIGNMENTS.map((entry) => [entry.id, entry.label]), image.align,
      (value) => change({ ...image, align: value })), { disabled }),
  ]
}

/** The system's own picker: Finder's open panel on the Mac, Photos or Files on iOS. */
function pickImageFile () {
  return new Promise((resolve) => {
    const input = element('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp' })
    input.style.display = 'none'
    input.addEventListener('change', () => { resolve(input.files?.[0] ?? null); input.remove() })
    input.addEventListener('cancel', () => { resolve(null); input.remove() })
    document.body.append(input)
    input.click()
  })
}

/**
 * Shrunk to what print needs — 1600 pixels on the long side is over 500 dpi at three inches —
 * and to what a settings file can reasonably carry. A photograph becomes a JPEG; anything
 * else stays a PNG, so a logo keeps its transparent background.
 */
async function prepareImage (file) {
  const url = URL.createObjectURL(file)
  try {
    const picture = new Image()
    picture.src = url
    await picture.decode()
    const { naturalWidth: width, naturalHeight: height } = picture
    if (!width || !height) throw new Error('It has no size.')
    const photo = file.type === 'image/jpeg'
    for (const longest of [1600, 1200, 800, 500]) {
      const scale = Math.min(1, longest / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      canvas.getContext('2d').drawImage(picture, 0, 0, canvas.width, canvas.height)
      const dataURL = photo ? canvas.toDataURL('image/jpeg', 0.88) : canvas.toDataURL('image/png')
      if (dataURL.length <= LETTERHEAD_IMAGE_MAX_LENGTH * 0.8) {
        return { dataURL, aspect: width / height, name: file.name }
      }
    }
    throw new Error('It is too large to keep in the settings.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

function trim (value) {
  return round(value, 1)
}

/** At most `digits` places, and no trailing zeros: 1.0 is `1`, 1.25 stays `1.25`. */
function round (value, digits) {
  return Number(Number(value).toFixed(digits)).toString()
}
