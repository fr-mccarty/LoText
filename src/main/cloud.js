// The Mac's end of iCloud sync (src/shared/sync/cloud-sync.js): the folder it writes, and the
// name a document's reading position is filed under.
//
// The folder is the iOS app's iCloud container, `iCloud.com.lolekproductions.lotext`. The Mac
// app is signed with a Developer ID and carries no iCloud entitlement, so it cannot ask for the
// container — but iCloud Drive keeps every container of the account under `~/Library/Mobile
// Documents` on each Mac, and an app outside the sandbox can read and write it there like any
// other directory. The directory appears once the iPhone or iPad app has used the container;
// until then sync is on and waiting, and says so.

import os from 'node:os'
import path from 'node:path'
import { promises as fs, watch, lstatSync, readdirSync, realpathSync } from 'node:fs'
import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import * as prefs from './prefs.js'
import { settings } from './settings.js'
import { createCloudSync, positionKey as sharedPositionKey } from '../shared/sync/cloud-sync.js'

const MOBILE_DOCUMENTS = path.join(os.homedir(), 'Library', 'Mobile Documents')
const CONTAINER = path.join(MOBILE_DOCUMENTS, 'iCloud~com~lolekproductions~lotext')
const SYNC_FOLDER = path.join(CONTAINER, 'Sync')

let watcher = null
let watchTimer = null

const folder = {
  async available () {
    try {
      if (!(await fs.stat(CONTAINER)).isDirectory()) return false
    } catch {
      return false
    }
    await fs.mkdir(SYNC_FOLDER, { recursive: true })
    startWatching()
    return true
  },
  unavailableMessage () {
    return 'Waiting for iCloud. Turn this on in LoText on an iPhone or iPad signed in to the same '
      + 'Apple Account; its iCloud folder then reaches this Mac. iCloud Drive must be on here too.'
  },
  async list () {
    return fs.readdir(SYNC_FOLDER)
  },
  async read (name) {
    return fs.readFile(path.join(SYNC_FOLDER, name), 'utf8')
  },
  /** Atomic, as the preferences are: a half-written file must never reach another device. */
  async write (name, text) {
    const target = path.join(SYNC_FOLDER, name)
    const temporary = path.join(SYNC_FOLDER, `.${name}.part`)
    await fs.writeFile(temporary, text, 'utf8')
    await fs.rename(temporary, target)
  },
}

/** The other devices' files change under iCloud's hand; a change is a reason to read them again. */
function startWatching () {
  if (watcher) return
  try {
    watcher = watch(SYNC_FOLDER, { persistent: false }, () => {
      clearTimeout(watchTimer)
      watchTimer = setTimeout(() => { cloud.refresh() }, 1500)
    })
    watcher.on('error', () => { watcher?.close(); watcher = null })
  } catch {
    watcher = null
  }
}

export const cloud = createCloudSync({
  prefs,
  settings,
  folder,
  deviceName: os.hostname().replace(/\.local$/, ''),
  newID: randomUUID,
  onStatus: (status) => {
    for (const browser of BrowserWindow.getAllWindows()) browser.webContents.send('cloud:status', status)
  },
})

/** At launch, and each time the app comes forward: the phone may have moved something. */
export function start () {
  cloud.refresh()
  let last = 0
  app.on('browser-window-focus', () => {
    if (Date.now() - last < 5000) return
    last = Date.now()
    cloud.refresh()
  })
}

// MARK: - Where a document is filed

/**
 * With Desktop & Documents in iCloud, `~/Documents` is iCloud Drive's Documents folder, and
 * iCloud Drive holds a link to it — `com~apple~CloudDocs/Documents → ~/Documents`. An iPhone
 * opening that folder sees it under `Mobile Documents`; so must the key made here.
 */
let aliases = null

function iCloudAliases () {
  if (aliases) return aliases
  aliases = []
  const drive = path.join(MOBILE_DOCUMENTS, 'com~apple~CloudDocs')
  try {
    for (const name of readdirSync(drive)) {
      const link = path.join(drive, name)
      if (!lstatSync(link).isSymbolicLink()) continue
      aliases.push({ from: realpathSync(link), to: link })
    }
  } catch {
    // No iCloud Drive on this Mac: nothing to translate.
  }
  return aliases
}

export function positionKey (absolutePath) {
  for (const { from, to } of iCloudAliases()) {
    if (absolutePath === from || absolutePath.startsWith(from + path.sep)) {
      return sharedPositionKey(to + absolutePath.slice(from.length))
    }
  }
  return sharedPositionKey(absolutePath)
}
