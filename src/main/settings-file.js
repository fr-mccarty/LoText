// Settings in and out as one JSON file: both tabs and every print preset, which is the whole of
// what the panel edits. Reached from two places — the Settings File buttons on either tab, and
// LoText ▸ Export Settings… / Import Settings… — so it lives here rather than in either.
//
// An import announces itself through `Settings`, so every open window and the panel follow it
// without being told separately.

import path from 'node:path'
import { promises as fs } from 'node:fs'
import { dialog } from 'electron'
import * as Settings from './settings.js'

/** `parent` is the window the dialog is a sheet on; none gives a free-floating panel. */
export async function exportSettings (parent) {
  const { canceled, filePath } = await dialog.showSaveDialog(parent ?? undefined, {
    title: 'Export Settings',
    defaultPath: 'LoText Settings.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  await fs.writeFile(filePath, JSON.stringify(Settings.exportable(), null, 2) + '\n', 'utf8')
  return { ok: true, path: filePath, name: path.basename(filePath) }
}

export async function importSettings (parent) {
  const { canceled, filePaths } = await dialog.showOpenDialog(parent ?? undefined, {
    title: 'Import Settings',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePaths?.length) return { ok: false, canceled: true }

  let data
  try {
    data = JSON.parse(await fs.readFile(filePaths[0], 'utf8'))
  } catch (error) {
    return { ok: false, reason: `That file is not readable JSON (${error.message}).` }
  }
  const result = Settings.importFrom(data)
  return result.ok
    ? { ...result, settings: Settings.read(), name: path.basename(filePaths[0]) }
    : result
}

/**
 * The menu's version, which has no panel to write a result into: a failure is said in an alert,
 * and a success says nothing, because the change it made is already on screen.
 */
export async function importSettingsFromMenu (parent) {
  const result = await importSettings(parent)
  if (!result.ok && !result.canceled) {
    await dialog.showMessageBox(parent ?? undefined, {
      type: 'warning',
      message: 'The settings could not be imported.',
      detail: result.reason,
    })
  }
}

export async function exportSettingsFromMenu (parent) {
  try {
    await exportSettings(parent)
  } catch (error) {
    await dialog.showMessageBox(parent ?? undefined, {
      type: 'warning',
      message: 'The settings could not be exported.',
      detail: error.message,
    })
  }
}
