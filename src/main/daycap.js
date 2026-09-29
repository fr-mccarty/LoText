// Cut and Send to DayCap, on the disk: the folder DayCap drops its files into, and the new file a
// selection becomes there. The folder is a path on this Mac, so it is kept in this Mac's own
// preferences, outside the settings bags: iCloud sync and Export Settings never carry it, and
// Restore Defaults leaves it alone.

import { dialog } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import * as prefs from './prefs.js'
import { dayCapFileName } from '../shared/daycap.js'
import { StoreError } from '../shared/store/errors.js'

const FOLDER_KEY = 'dayCapFolder'

export const folder = () => prefs.get(FOLDER_KEY, null)

/** Asks for the folder, over `parent`. The chosen path, or null when the dialog was cancelled. */
export async function chooseFolder (parent) {
  const result = await dialog.showOpenDialog(parent, {
    properties: ['openDirectory', 'createDirectory'],
    message: 'Choose the folder DayCap drops its files into.',
    buttonLabel: 'Choose',
    defaultPath: folder() ?? undefined,
  })
  if (result.canceled || !result.filePaths.length) return null
  prefs.set(FOLDER_KEY, result.filePaths[0])
  return result.filePaths[0]
}

/**
 * Saves `text`, exactly as given, as a new `.md` file in the folder, asking for the folder first
 * when none has been chosen. The new file's name, or null when that question was cancelled. A
 * file already there is never written over: a taken name moves on to the next one.
 */
export async function send (parent, text) {
  const target = folder() ?? await chooseFolder(parent)
  if (!target) return null
  const stat = await fs.stat(target).catch(() => null)
  if (!stat?.isDirectory()) {
    throw new StoreError('notFound',
      `The DayCap folder, ${target}, is not there. Choose it again in Settings ▸ Editor.`)
  }
  const now = new Date()
  for (let attempt = 1; ; attempt++) {
    const name = dayCapFileName(now, attempt)
    try {
      await fs.writeFile(path.join(target, name), text, { flag: 'wx' })
      return name
    } catch (error) {
      if (error.code === 'EEXIST') continue
      throw new StoreError('failed', `The text could not be saved in the DayCap folder, ${target}. ${error.message}`)
    }
  }
}
