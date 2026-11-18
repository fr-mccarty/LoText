// Everything the renderer can ask for, and nothing else. The model lives in the renderer; the
// file system lives here, and this is the door between them.
//
// Every store call goes through `withStore`, which is what keeps the one-door rule intact
// across a process boundary: there is no path here that reaches the disk without a window's
// own store resolving it first.

import { ipcMain, dialog, shell, BrowserWindow, app, clipboard } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import zlib from 'node:zlib'
import * as FilePath from '../shared/file-path.js'
import * as Settings from './settings.js'
import * as SettingsFile from './settings-file.js'
import { cloud, positionKey } from './cloud.js'
import * as Session from './session.js'
import * as Recovery from './recovery.js'
import * as Keys from './store/ssh-keys.js'
import { describeError, StoreError, notFound } from '../shared/store/errors.js'
import { decode, encode } from '../shared/text-coding.js'
import { walk } from '../shared/store/walk.js'
import { recentlyEdited } from '../shared/store/recent.js'
import { extract } from '../shared/viewers/document-text.js'
import { parseLocation, identity as remoteIdentity } from '../shared/store/remote-location.js'
import { print as runPrint } from './print/printer.js'
import * as Windows from './window.js'
import { openSettingsWindow, settingsWindow } from './settings-window.js'
import * as DayCap from './daycap.js'

/** Every handler answers `{ ok: true, value }` or `{ ok: false, error }` — never a throw. */
function answer (handler) {
  return async (event, ...args) => {
    const entry = Windows.forWebContents(event.sender)
    try {
      return { ok: true, value: await handler(entry, ...args) }
    } catch (error) {
      return { ok: false, error: describeError(error) }
    }
  }
}

function withStore (entry) {
  if (!entry?.store) throw new StoreError('noFolder', 'No folder is open in this window.')
  return entry.store
}

export function registerHandlers () {
  // MARK: - The folder

  ipcMain.handle('folder:open', answer(async (entry) => {
    const result = await dialog.showOpenDialog(entry.browser, {
      properties: ['openDirectory', 'createDirectory'],
      message: 'Choose a folder to work in.',
      buttonLabel: 'Open',
    })
    if (result.canceled || !result.filePaths.length) return null
    return adoptLocal(entry, result.filePaths[0])
  }))

  ipcMain.handle('folder:adopt', answer(async (entry, folder) => adoptLocal(entry, folder)))

  ipcMain.handle('folder:connect', answer(async (entry, address) => {
    const location = parseLocation(address)
    if (!location) {
      throw new StoreError('badAddress',
        'That is not an address this understands. Try user@host:/path.')
    }
    const store = await Windows.remoteStoreFor(location)
    const described = await entry.adopt(store)
    // An address is written down only *after* a connection has succeeded, so the list is
    // places that have answered rather than a history of things that were typed.
    cloud.rememberServer({
      id: remoteIdentity(location),
      address: address.trim(),
      location,
    })
    Session.rememberFolder(Windows.recentEntryFor(store))
    return described
  }))

  ipcMain.handle('folder:describe', answer((entry) => entry.describeFolder()))

  ipcMain.handle('folder:refreshAvailability', answer(async (entry) => {
    const store = withStore(entry)
    await store.refreshAvailability()
    return store.isUnavailable
  }))

  ipcMain.handle('folder:saveExpansion', answer((entry, paths) => {
    if (entry.store) Session.saveExpansion(entry.store.identity, paths)
    return true
  }))

  // MARK: - Listing and reading

  ipcMain.handle('store:children', answer((entry, folder) => withStore(entry).children(folder)))

  ipcMain.handle('store:readText', answer(async (entry, filePath) => {
    const store = withStore(entry)
    const { data, stamp } = await store.read(filePath)
    const { text, lineEnding } = decode(data, filePath)
    return { text, lineEnding, stamp }
  }))

  ipcMain.handle('store:writeText', answer(async (entry, filePath, text, lineEnding, expected) => {
    const store = withStore(entry)
    return store.write(encode(text, lineEnding), filePath, expected ?? null)
  }))

  /**
   * The way out when a file cannot be saved where it lives: the text goes wherever the user
   * points, outside the folder. The one write that is not the store's, because the place it
   * rescues text from is exactly the place that is failing. Null when the dialog is cancelled.
   */
  ipcMain.handle('file:saveCopyAs', answer(async (entry, name, text, lineEnding) => {
    const result = await dialog.showSaveDialog(entry.browser, {
      defaultPath: path.join(app.getPath('home'), name),
      message: 'Save the text somewhere it can be written.',
      buttonLabel: 'Save',
    })
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(result.filePath, encode(text, lineEnding))
    return result.filePath
  }))

  ipcMain.handle('store:stamp', answer((entry, filePath) => withStore(entry).stamp(filePath)))
  ipcMain.handle('store:exists', answer((entry, filePath) => withStore(entry).exists(filePath)))

  // MARK: - Mutations

  ipcMain.handle('store:create', answer(async (entry, kind, name, parent) => {
    const store = withStore(entry)
    const unique = await store.uniqueName(parent, name)
    return store.create(kind, unique, parent)
  }))

  ipcMain.handle('store:rename', answer((entry, filePath, name) =>
    withStore(entry).rename(filePath, name)))

  ipcMain.handle('store:move', answer((entry, filePath, destination) =>
    withStore(entry).move(filePath, destination)))

  ipcMain.handle('store:duplicate', answer((entry, filePath) =>
    withStore(entry).duplicate(filePath)))

  ipcMain.handle('store:delete', answer((entry, filePath, options) =>
    withStore(entry).delete(filePath, options)))

  ipcMain.handle('store:linkTarget', answer(async (entry, filePath) => {
    const store = withStore(entry)
    if (!store.linkTarget) return null
    const target = await store.linkTarget(filePath)
    if (!target) return null
    return adoptLocal(entry, target)
  }))

  ipcMain.handle('store:reveal', answer((entry, filePath, isFolder) => {
    const store = withStore(entry)
    const target = store.localURL(filePath)
    if (!target) return false                 // a folder on a server has no Finder window
    if (isFolder) shell.openPath(target)
    else shell.showItemInFolder(target)
    return true
  }))

  ipcMain.handle('store:copyAbsolutePath', answer((entry, filePath) => {
    const target = withStore(entry).localURL(filePath)
    if (!target) return false                 // a folder on a server has no path on this Mac
    clipboard.writeText(target)
    return true
  }))

  // A wiki link to a web address (specs/wiki-links.md), in the system's browser. Web and mail
  // addresses only: nothing that could start a program or open a file on the disk.
  ipcMain.handle('shell:openExternal', answer(async (_entry, address) => {
    const url = new URL(String(address))
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw new StoreError('failed', 'Only web and mail addresses open from a link.')
    await shell.openExternal(url.href)
    return true
  }))

  // MARK: - The viewers

  /**
   * Bytes for a viewer, as a data URL. Images, PDFs and documents are built from bytes read
   * through the store, so the read goes the same way every other read goes; the player is
   * handed a file instead, because it holds the file open for as long as it is on screen.
   */
  ipcMain.handle('viewer:load', answer(async (entry, filePath, viewer) => {
    const store = withStore(entry)
    if (viewer === 'media') {
      const local = store.localURL(filePath) ?? await store.fetchForViewing(filePath)
      return { kind: 'file', path: local }
    }
    const { data } = await store.read(filePath)
    if (viewer === 'image') {
      return { kind: 'image', dataURL: dataURL(data, mimeFor(filePath)) }
    }
    if (viewer === 'pdf') {
      return { kind: 'pdf', dataURL: dataURL(data, 'application/pdf') }
    }
    const document = await extract(data, FilePath.name(filePath), inflateRaw)
    if (document.kind === 'image') {
      return { kind: 'image', dataURL: dataURL(document.data, document.mime) }
    }
    return document
  }))

  // MARK: - Finding a file by name

  ipcMain.handle('search:walk', answer(async (entry, token) => {
    const store = withStore(entry)
    entry.walkToken = token
    await walk(store,
      (batch) => entry.send('search:batch', { token, ...batch }),
      () => entry.walkToken !== token)
    entry.send('search:done', { token })
    return true
  }))

  ipcMain.handle('search:cancel', answer((entry) => { entry.walkToken = null; return true }))

  // MARK: - Recently edited files

  ipcMain.handle('recent:list', answer(async (entry, token) => {
    const store = withStore(entry)
    entry.recentToken = token
    return recentlyEdited(store, () => entry.recentToken !== token)
  }))

  ipcMain.handle('recent:cancel', answer((entry) => { entry.recentToken = null; return true }))

  // MARK: - The working save

  ipcMain.handle('recovery:write', answer((entry, filePath, text) =>
    Recovery.write(entry.store?.identity ?? '', filePath, text)))

  ipcMain.handle('recovery:read', answer((entry, filePath, diskText) =>
    Recovery.read(entry.store?.identity ?? '', filePath, diskText)))

  ipcMain.handle('recovery:discard', answer((entry, filePath) =>
    Recovery.discard(entry.store?.identity ?? '', filePath)))

  // MARK: - Settings

  ipcMain.handle('settings:read', answer(() => Settings.read()))
  ipcMain.handle('settings:setView', answer((_entry, patch) => { Settings.setView(patch); return Settings.read() }))
  ipcMain.handle('settings:restoreView', answer(() => { Settings.restoreViewDefaults(); return Settings.read() }))
  ipcMain.handle('settings:selectPreset', answer((_entry, id) => { Settings.selectPreset(id); return Settings.read() }))
  ipcMain.handle('settings:updatePreset', answer((_entry, patch) => { Settings.updateActivePreset(patch); return Settings.read() }))
  ipcMain.handle('settings:addPreset', answer((_entry, kind) => { Settings.addPreset(kind); return Settings.read() }))
  ipcMain.handle('settings:duplicatePreset', answer(() => { Settings.duplicateActivePreset(); return Settings.read() }))
  ipcMain.handle('settings:renamePreset', answer((_entry, name) => { Settings.renameActivePreset(name); return Settings.read() }))
  ipcMain.handle('settings:deletePreset', answer(() => { Settings.deleteActivePreset(); return Settings.read() }))
  ipcMain.handle('settings:restorePrint', answer(() => { Settings.restorePrintDefaults(); return Settings.read() }))
  ipcMain.handle('cloud:status', answer(() => cloud.status()))
  ipcMain.handle('cloud:setEnabled', answer((_entry, on) => cloud.setEnabled(Boolean(on))))

  // MARK: - Where each document was left

  ipcMain.handle('position:read', answer((entry, filePath) => cloud.position(documentKey(entry, filePath))))
  ipcMain.handle('position:save', answer((entry, filePath, position) => {
    cloud.rememberPosition(documentKey(entry, filePath), position)
    return true
  }))
  ipcMain.handle('settings:open', answer(() => { openSettingsWindow(); return true }))
  // The panel names itself after the tab it is showing, so the title and the tab bar never
  // disagree. It comes from the renderer because the renderer is the only side that knows
  // which tab is selected — the tab is not a stored setting.
  ipcMain.handle('settings:title', answer((_entry, title) => {
    settingsWindow()?.setTitle(title)
    return true
  }))

  // Settings in and out as one JSON file. The file dialogs are sheets on the settings window
  // rather than free-floating panels, so they belong to the window the buttons are in.
  ipcMain.handle('settings:export', answer(() => SettingsFile.exportSettings(settingsWindow())))
  ipcMain.handle('settings:import', answer(() => SettingsFile.importSettings(settingsWindow())))

  // MARK: - Lists the app keeps

  ipcMain.handle('recents:folders', answer(() => Session.recentFolderTitles()))
  ipcMain.handle('recents:openFolder', answer(async (entry, id) => {
    const found = Session.recentFolders().find((item) => item.id === id)
    if (!found) throw notFound(id)
    if (found.kind === 'remote') {
      const store = await Windows.remoteStoreFor(found.location)
      Session.rememberFolder(found)
      return entry.adopt(store)
    }
    return adoptLocal(entry, found.id)
  }))
  ipcMain.handle('recents:forgetFolder', answer((_entry, id) => { Session.forgetFolder(id); return true }))
  ipcMain.handle('recents:clearFolders', answer(() => { Session.clearRecentFolders(); return true }))
  ipcMain.handle('recents:servers', answer(() => cloud.servers()))

  ipcMain.handle('ssh:publicKey', answer(async () => {
    await Keys.ensure()
    return Keys.publicKeyText()
  }))
  ipcMain.handle('clipboard:write', answer((_entry, text) => { clipboard.writeText(text); return true }))

  // Cut, Copy and Paste from the editor's own menu: the same as the Edit menu's, done by the
  // window's web contents, so the editor sees ordinary cut, copy and paste events.
  ipcMain.handle('edit:perform', async (event, action) => {
    if (['cut', 'copy', 'paste'].includes(action)) event.sender[action]()
    return { ok: true, value: true }
  })

  // MARK: - DayCap

  // The settings window asks too, and it is not one of the app's windows, so a dialog's parent
  // is whichever window asked.
  const askingWindow = (event) => BrowserWindow.fromWebContents(event.sender)
  const answerWithWindow = (handler) => async (event, ...args) => {
    try {
      return { ok: true, value: await handler(askingWindow(event), ...args) }
    } catch (error) {
      return { ok: false, error: describeError(error) }
    }
  }
  ipcMain.handle('daycap:folder', answerWithWindow(() => DayCap.folder()))
  ipcMain.handle('daycap:chooseFolder', answerWithWindow((parent) => DayCap.chooseFolder(parent)))
  ipcMain.handle('daycap:send', answerWithWindow((parent, text) => DayCap.send(parent, String(text))))

  // MARK: - Printing

  ipcMain.handle('print:file', answer(async (entry, { text, fileName }) => {
    const preset = Settings.activePreset()
    return runPrint({
      text,
      settings: Settings.printSnapshot(preset),
      fileName,
      folderName: entry.store?.rootName ?? '',
      paper: preset.paper ?? 'letter',
    })
  }))

  // MARK: - The window itself

  ipcMain.handle('window:title', answer((entry, title, isEdited) => {
    if (entry.browser.isDestroyed()) return false
    entry.browser.setTitle(title)
    entry.browser.setDocumentEdited(Boolean(isEdited))
    return true
  }))

  ipcMain.handle('window:noteOpenFile', answer((entry, filePath) => {
    entry.lastOpenFile = filePath
    return true
  }))

  ipcMain.handle('window:new', answer(() => { Windows.createWindow(); return true }))
  ipcMain.handle('window:close', answer((entry) => { entry.browser.close(); return true }))
  ipcMain.handle('window:settled', answer((entry) => { Windows.finishClose(entry); return true }))
  ipcMain.handle('window:holdClose', answer((entry) => { entry.closeHeld = true; return true }))
  ipcMain.handle('window:cancelClose', answer((entry) => { Windows.cancelClose(entry); return true }))
  ipcMain.handle('window:restoreRecord', answer((entry) => {
    const record = entry.restore
    entry.restore = null
    return record
  }))

  ipcMain.handle('dialog:message', answer(async (entry, options) => {
    const result = await dialog.showMessageBox(entry.browser, {
      type: options.type ?? 'warning',
      message: options.title,
      detail: options.message,
      buttons: options.buttons,
      defaultId: options.defaultId ?? 0,
      cancelId: options.cancelId ?? options.buttons.length - 1,
    })
    return result.response
  }))

  ipcMain.handle('app:quit', answer(() => { app.quit(); return true }))
}

/**
 * The name a document's position is filed under: under iCloud Drive, the same on every device;
 * on a server, the server's own name for it.
 */
function documentKey (entry, filePath) {
  const store = withStore(entry)
  if (store.kind === 'remote') return `ssh:${store.identity}/${filePath}`
  return positionKey(store.resolve(filePath))
}

// MARK: - Adopting a local folder

async function adoptLocal (entry, folder) {
  const store = await Windows.localStoreFor(folder)
  const described = await entry.adopt(store)
  // Written down only after the folder has actually opened: a folder that failed to open is
  // not a folder anybody has worked in.
  Session.rememberFolder(Windows.recentEntryFor(store))
  return described
}

const inflateRaw = promisify(zlib.inflateRaw)

function dataURL (data, mime) {
  return `data:${mime};base64,${Buffer.from(data).toString('base64')}`
}

function mimeFor (filePath) {
  const extension = path.extname(filePath).toLowerCase()
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.icns': 'image/x-icns',
    '.tiff': 'image/tiff',
    '.heic': 'image/heic',
  }[extension] ?? 'application/octet-stream'
}

