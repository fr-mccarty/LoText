// Cut and Send to DayCap, on the disk: the folder DayCap drops its files into, and the new file a
// selection becomes there. The folder is a path on this Mac, so it is kept in this Mac's own
// preferences, outside the settings bags: iCloud sync and Export Settings never carry it, and
// Restore Defaults leaves it alone.
//
// DayCap itself has no fixed folder: the iPhone keeps a bookmark to whichever one the user
// picked. Its suggested one is `iCloud Drive/DayCap`, its own iCloud container, so that is where
// the question opens when nothing has been chosen yet.

import { app, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import * as prefs from './prefs.js'
import { dayCapFileName } from '../shared/daycap.js'
import { StoreError } from '../shared/store/errors.js'

const FOLDER_KEY = 'dayCapFolder'

/** DayCap's iCloud container as this Mac sees it — `iCloud Drive/DayCap` in Finder and Files. */
const DAYCAP_ICLOUD = ['Library', 'Mobile Documents', 'iCloud~org~lolekproductions~daycap', 'Documents']

export const folder = () => prefs.get(FOLDER_KEY, null)

const isFolder = async (target) => Boolean(target && (await fs.stat(target).catch(() => null))?.isDirectory())

/**
 * Asks for the folder, over `parent`. The chosen path, or null when the dialog was cancelled.
 * `gone` is a remembered folder that is no longer there, which the question names.
 */
export async function chooseFolder (parent, gone = null) {
  const remembered = folder()
  const suggested = path.join(app.getPath('home'), ...DAYCAP_ICLOUD)
  const result = await dialog.showOpenDialog(parent, {
    properties: ['openDirectory', 'createDirectory'],
    message: gone
      ? `The DayCap folder, ${gone}, is not there any more. Choose the folder DayCap drops its files into.`
      : 'Choose the folder DayCap drops its files into.',
    buttonLabel: 'Choose',
    defaultPath: (await isFolder(remembered)) ? remembered
      : (await isFolder(suggested)) ? suggested : undefined,
  })
  if (result.canceled || !result.filePaths.length) return null
  prefs.set(FOLDER_KEY, result.filePaths[0])
  return result.filePaths[0]
}

/**
 * Saves `text`, exactly as given, as a new `.md` file in the folder, asking for the folder first
 * when none has been chosen or the chosen one has gone. The new file's name, or null when that
 * question was cancelled.
 */
export async function send (parent, text) {
  const remembered = folder()
  const target = (await isFolder(remembered)) ? remembered : await chooseFolder(parent, remembered)
  if (!target) return null
  return writeNote(target, text)
}

/**
 * `text` as a new file in `target`, named as DayCap names its captures at `now`. A file already
 * there is never written over: a taken name moves on to the next one.
 */
export async function writeNote (target, text, now = new Date()) {
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
