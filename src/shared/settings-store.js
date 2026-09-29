// Two bags that never touch, and the storage behind them.
//
// VIEW is the screen. PRINT is paper, and PRINT is a *list* of named presets with one of them
// selected. No value is shared, nothing reads across, and each bag has its own Restore
// Defaults. Margins appear in PRINT and nowhere else in the entire app.
//
// The storage is handed in — `{ get, set, flush }` — because the Mac keeps it in the main
// process's JSON file and iOS keeps it in the app's own data directory, and the rules below are
// the same on both. `newID` makes a preset's id; `viewDefaults` lets a platform start the editor
// somewhere other than the Mac's defaults (a phone wants bigger text).

import {
  DEFAULT_VIEW, normalizeView, normalizePreset, standardPreset, makePreset,
  DEFAULT_PRESET_ID, snapshot, builtInPresets, PRESET_KINDS,
} from './settings-shape.js'

const VIEW_KEY = 'view'
const PRESETS_KEY = 'print.presets'
const ACTIVE_KEY = 'print.activePreset'
/** Set once the built-in presets have been offered to settings that predate them. */
const BUILT_INS_KEY = 'print.builtInsAdded'

/**
 * What an export writes, and what an import expects to read.
 *
 * `format` is what makes a file recognisable as this app's rather than any other JSON, and
 * `version` is what lets a later shape be read without guessing: nothing reads it yet, but an
 * importer that cannot tell version 1 from version 2 has no way to migrate one to the other.
 */
const EXPORT_FORMAT = 'lotext.settings'
const EXPORT_VERSION = 1

export function createSettings (prefs, newID, { viewDefaults = {} } = {}) {
  const defaultView = normalizeView({ ...DEFAULT_VIEW, ...viewDefaults })
  const listeners = new Set()

  /** Anything that wants to know a setting moved — every open window, and the settings panel. */
  function onChange (listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function announce () {
    const state = read()
    for (const listener of listeners) listener(state)
  }

  // MARK: - Reading

  function view () {
    return normalizeView(prefs.get(VIEW_KEY, defaultView))
  }

  function presets () {
    const stored = prefs.get(PRESETS_KEY, null)
    if (!Array.isArray(stored) || !stored.length) return builtInPresets()
    const list = stored.map((raw) => normalizePreset(raw))
    if (!prefs.get(BUILT_INS_KEY, false)) addBuiltIns(list)
    // The Default preset is always there and always first: there has to be something to print
    // with, and it is the one preset that cannot be deleted.
    if (!list.some((preset) => preset.id === DEFAULT_PRESET_ID)) list.unshift(standardPreset())
    return list
  }

  /**
   * Once, for settings saved before the built-in presets existed: add whichever of them is
   * missing (by id, or by a preset of the same name the person already made), and move a
   * Default still in the old stock monospaced face to Times New Roman. A built-in deleted
   * afterwards stays deleted.
   */
  function addBuiltIns (list) {
    const names = new Set(list.map((preset) => preset.name.toLowerCase()))
    for (const preset of builtInPresets()) {
      if (list.some((existing) => existing.id === preset.id) ||
        names.has(preset.name.toLowerCase())) continue
      list.push(preset)
    }
    const fallback = list.find((preset) => preset.id === DEFAULT_PRESET_ID)
    if (fallback && fallback.bodyFont === 'systemMono' && fallback.headingFont === 'systemMono') {
      fallback.bodyFont = 'times'
      fallback.headingFont = 'times'
    }
    prefs.set(PRESETS_KEY, list)
    prefs.set(BUILT_INS_KEY, true)
  }

  function activePresetID () {
    const id = prefs.get(ACTIVE_KEY, DEFAULT_PRESET_ID)
    const list = presets()
    return list.some((preset) => preset.id === id) ? id : list[0].id
  }

  function activePreset () {
    const id = activePresetID()
    return presets().find((preset) => preset.id === id) ?? standardPreset()
  }

  /** The preset a print job runs under: the selected one, or the one `--preset` named. */
  function presetNamed (name) {
    if (!name) return activePreset()
    const found = presets().find((preset) => preset.name.toLowerCase() === name.toLowerCase())
    return found ?? null
  }

  function read () {
    return { view: view(), presets: presets(), activePresetID: activePresetID() }
  }

  function printSnapshot (preset = activePreset()) {
    return snapshot(preset)
  }

  // MARK: - Writing

  function setView (patch) {
    prefs.set(VIEW_KEY, normalizeView({ ...view(), ...patch }))
    announce()
  }

  function restoreViewDefaults () {
    prefs.set(VIEW_KEY, { ...defaultView })
    announce()
  }

  /** ⌘+ / ⌘- / ⌘0. Written back through the same setter, so the menu and the panel agree. */
  function stepFontSize (delta) {
    setView({ editorFontSize: view().editorFontSize + delta })
  }

  function resetFontSize () {
    setView({ editorFontSize: defaultView.editorFontSize })
  }

  function writePresets (list, activeID) {
    prefs.set(PRESETS_KEY, list)
    // The list written was read through presets(), so it has had its built-ins already.
    prefs.set(BUILT_INS_KEY, true)
    if (activeID) prefs.set(ACTIVE_KEY, activeID)
    announce()
  }

  function selectPreset (id) {
    if (!presets().some((preset) => preset.id === id)) return
    prefs.set(ACTIVE_KEY, id)
    announce()
  }

  /** Everything the Printing tab edits belongs to *the selected preset*. */
  function updateActivePreset (patch) {
    const id = activePresetID()
    const list = presets().map((preset) =>
      preset.id === id ? normalizePreset({ ...preset, ...patch }, id) : preset)
    writePresets(list, id)
  }

  function addPreset (kind) {
    const list = presets()
    const label = PRESET_KINDS.find((entry) => entry.id === kind)?.label ??
      kind.charAt(0).toUpperCase() + kind.slice(1)
    const preset = makePreset(kind, uniqueName(list, label), newID())
    writePresets([...list, preset], preset.id)
    return preset.id
  }

  function duplicateActivePreset () {
    const list = presets()
    const source = activePreset()
    const copy = normalizePreset({ ...source, name: uniqueName(list, `${source.name} copy`) },
      newID())
    writePresets([...list, copy], copy.id)
    return copy.id
  }

  function renameActivePreset (name) {
    const trimmed = String(name ?? '').trim()
    if (!trimmed) return
    const list = presets()
    updateActivePreset({ name: uniqueName(list.filter((p) => p.id !== activePresetID()), trimmed) })
  }

  function canDeleteActivePreset () {
    return activePresetID() !== DEFAULT_PRESET_ID && presets().length > 1
  }

  function deleteActivePreset () {
    if (!canDeleteActivePreset()) return
    const id = activePresetID()
    const list = presets().filter((preset) => preset.id !== id)
    writePresets(list, list[0].id)
  }

  /**
   * Restores the *selected* preset to the values of the kind it was made from, and leaves its
   * name and every other preset alone.
   */
  function restorePrintDefaults () {
    const current = activePreset()
    const fresh = makePreset(current.kind, current.name, current.id)
    const list = presets().map((preset) => (preset.id === current.id ? fresh : preset))
    writePresets(list, current.id)
  }

  // MARK: - The settings file, in and out

  /** Everything both tabs hold, in one plain object ready to be written as JSON. */
  function exportable () {
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      view: view(),
      presets: presets(),
      activePresetID: activePresetID(),
    }
  }

  /**
   * Replace the settings with a file's, or explain why the file is not one.
   *
   * Everything is put through the same normalisers the app uses on its own stored values, so a
   * hand-edited file with a 900pt font or a missing field lands on something valid rather than
   * breaking the panel. The write happens only once the whole file has been read and
   * normalised: a file that turns out to be bad half way through leaves the current settings
   * alone.
   */
  function importFrom (data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, reason: 'That file does not contain settings.' }
    }
    if (data.format !== EXPORT_FORMAT) {
      return { ok: false, reason: 'That is not a LoText settings file.' }
    }
    if (Number(data.version) > EXPORT_VERSION) {
      return { ok: false, reason: `That file was written by a newer version of LoText (format ${data.version}).` }
    }
    if (!Array.isArray(data.presets) || !data.presets.length) {
      return { ok: false, reason: 'That settings file has no print presets in it.' }
    }

    const { incoming, active } = normalizedPresets(data.presets, data.activePresetID)

    prefs.set(VIEW_KEY, normalizeView(data.view ?? defaultView))
    prefs.set(PRESETS_KEY, incoming)
    prefs.set(ACTIVE_KEY, active)
    // An import replaces every preset: what the file holds is the list, built-ins or not.
    prefs.set(BUILT_INS_KEY, true)
    prefs.flush()
    announce()
    return { ok: true, presets: incoming.length }
  }

  /**
   * Values that arrived from another device over iCloud (src/shared/sync/cloud-sync.js): some of
   * the editor's keys, and the presets as one unit. Put through the same normalisers as an
   * import, so another device's value is clamped the way this one's would be.
   */
  function applySynced ({ view: viewPatch, print } = {}) {
    if (viewPatch) prefs.set(VIEW_KEY, normalizeView({ ...view(), ...viewPatch }))
    if (Array.isArray(print?.presets) && print.presets.length) {
      const { incoming, active } = normalizedPresets(print.presets, print.activePresetID)
      prefs.set(PRESETS_KEY, incoming)
      prefs.set(ACTIVE_KEY, active)
      prefs.set(BUILT_INS_KEY, true)
    }
    announce()
  }

  return {
    onChange,
    view,
    presets,
    activePresetID,
    activePreset,
    presetNamed,
    read,
    printSnapshot,
    setView,
    restoreViewDefaults,
    stepFontSize,
    resetFontSize,
    selectPreset,
    updateActivePreset,
    addPreset,
    duplicateActivePreset,
    renameActivePreset,
    canDeleteActivePreset,
    deleteActivePreset,
    restorePrintDefaults,
    exportable,
    importFrom,
    applySynced,
  }
}

/** A list of presets from outside — a file or another device — made into one the app can use. */
function normalizedPresets (list, activeID) {
  const incoming = list.map((raw) => normalizePreset(raw))
  // The Default preset cannot be deleted in the panel, so it cannot be imported away either.
  if (!incoming.some((preset) => preset.id === DEFAULT_PRESET_ID)) incoming.unshift(standardPreset())
  const active = incoming.some((preset) => preset.id === activeID) ? activeID : incoming[0].id
  return { incoming, active }
}

function uniqueName (list, proposed) {
  const taken = new Set(list.map((preset) => preset.name.toLowerCase()))
  if (!taken.has(proposed.toLowerCase())) return proposed
  let counter = 2
  for (;;) {
    const candidate = `${proposed} ${counter}`
    if (!taken.has(candidate.toLowerCase())) return candidate
    counter += 1
  }
}
