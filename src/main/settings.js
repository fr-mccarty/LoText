// The Mac's settings: the shared rules in `src/shared/settings-store.js`, kept in the main
// process's JSON file. Every window and the settings panel reach them from here.

import { randomUUID } from 'node:crypto'
import * as prefs from './prefs.js'
import { createSettings } from '../shared/settings-store.js'

/** The store itself, for iCloud sync (src/main/cloud.js), which listens to it and writes through it. */
export const settings = createSettings(prefs, randomUUID)

export const {
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
} = settings
