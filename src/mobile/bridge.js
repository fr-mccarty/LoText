// The iOS and Android bridge: what src/main/preload.js and src/main/ipc.js are on the Mac, as one
// object the model is handed as `window.lotext`. Every method the Mac's bridge has is here, with the same
// answers, so the model does not know which platform it is on. Where iOS has no equivalent —
// windows, the menu bar — the method is a quiet no-op or refuses in a sentence.
//
// The store is the only thing that touches the disk, as on the Mac: nothing here resolves a
// path, and every file operation goes to the store for the folder being held open.

import * as FilePath from '../shared/file-path.js'
import { decode, encode } from '../shared/text-coding.js'
import { walk } from '../shared/store/walk.js'
import { recentlyEdited } from '../shared/store/recent.js'
import { StoreError, notFound } from '../shared/store/errors.js'
import { extract } from '../shared/viewers/document-text.js'
import { createSettings } from '../shared/settings-store.js'
import { setHiddenFilesShown } from '../shared/store/names.js'
import { createCloudSync, positionKey } from '../shared/sync/cloud-sync.js'
import { sendToDayCap } from './daycap.js'
import { MobileStore } from './mobile-store.js'
import { RemoteStore } from '../shared/store/remote-store.js'
import { parseLocation, address as addressOf, identity as remoteIdentity, displayName as remoteName, target } from '../shared/store/remote-location.js'
import { sshTransport, publicKey } from './ssh-transport.js'
import { Native, fromBase64, toBase64, chooseFrom } from './native.js'
import * as prefs from './prefs.js'
import * as Recovery from './recovery.js'
import { printDocument } from './printing.js'
import { cloudFolder, watchCloud } from './cloud.js'
import { Capacitor } from '@capacitor/core'

/**
 * `ios` or `android`. Android runs the same web half on its own LoTextNative
 * (android/app/src/main/java/…/LoTextNativePlugin.java), which does not have Connect to Server,
 * iCloud sync or Send to DayCap yet — so those are left out of what this bridge offers there.
 */
const PLATFORM = Capacitor.getPlatform() === 'android' ? 'android' : 'ios'
const ANDROID = PLATFORM === 'android'

/** The app's own folder — Documents, which Files shows as On My iPhone ▸ LoText. */
export const APP_FOLDER = 'app'

const RECENTS_KEY = 'recentFolders'
const SESSION_KEY = 'session'
const EXPANSION_KEY = 'expansion'
const MAX_RECENTS = 10

/** A phone is held further away than a laptop's screen; the Mac's 13 is small there. */
const PHONE_VIEW_DEFAULTS = { editorFontSize: 16 }

/**
 * What Cut and Send to DayCap (`./daycap.js`) needs from LoTextNative. The picker cannot say
 * why it is up, so a folder that has gone is named in an alert first, as the Mac's question does.
 */
const dayCapNative = {
  folder: () => Native.dayCapFolder(),
  choose: async (gone) => {
    if (gone) {
      const { index } = await Native.alert({
        title: `The DayCap folder, ${gone}, is not there any more.`,
        message: 'Choose the folder DayCap drops its files into.',
        buttons: ['Choose…', 'Cancel'],
        cancelIndex: 1,
      })
      if (index !== 0) return null
    }
    return (await Native.pickDayCapFolder()).name ?? null
  },
  write: ({ name, text }) => Native.writeToDayCap({ name, data: toBase64(new TextEncoder().encode(text)) }),
}

export function createBridge () {
  const ready = prefs.load()
  const settings = createSettings(prefs, newID, { viewDefaults: PHONE_VIEW_DEFAULTS })
  const cloud = createCloudSync({
    prefs,
    settings,
    folder: cloudFolder,
    deviceName: deviceName(),
    newID,
    onStatus: (status) => emit('cloud:status', status),
  })

  let store = null
  let walkToken = null
  let recentToken = null
  let restoreRecord = null
  let restoreTaken = false

  /** name → Set of listeners, for what the Mac sends over IPC. */
  const channels = new Map()
  function on (channel, listener) {
    if (!channels.has(channel)) channels.set(channel, new Set())
    channels.get(channel).add(listener)
    return () => channels.get(channel)?.delete(listener)
  }
  function emit (channel, payload) {
    for (const listener of [...(channels.get(channel) ?? [])]) listener(payload)
  }

  function withStore () {
    if (!store) throw new StoreError('noFolder', 'No folder is open.')
    return store
  }

  // MARK: - The folder

  function describe () {
    if (!store) return null
    const expansion = prefs.get(EXPANSION_KEY, {})?.[store.identity]
    return {
      key: store.identity,
      name: store.rootName,
      kind: store.kind,
      capabilities: store.capabilities,
      isUnavailable: store.isUnavailable,
      expansion: Array.isArray(expansion) ? expansion : [],
    }
  }

  /** Every way a folder is opened ends here: the store is made, remembered, and described. */
  async function adopt (folder) {
    store?.close()
    store = new MobileStore(folder)
    await store.refreshAvailability()
    rememberFolder({ id: folder.id, name: folder.name, detail: folder.detail ?? '' })
    saveSession({ folder: { kind: 'local', path: folder.id, name: folder.name }, openFile: null })
    emit('ui:folder', describe())
    return describe()
  }

  /**
   * Connect to Server: a folder on another machine, over the app's own SSH. As on the Mac, an
   * address is written down only after the connection has succeeded.
   */
  async function connectToServer (address) {
    const location = parseLocation(address)
    if (!location) {
      throw new StoreError('badAddress', 'That is not an address this understands. Try user@host:/path.')
    }
    const remote = new RemoteStore(location, sshTransport)
    await remote.connect()
    store?.close()
    store = remote
    const id = remoteIdentity(location)
    cloud.rememberServer({ id, address: address.trim(), location })
    rememberFolder({ id, kind: 'remote', name: remoteName(location), detail: target(location), location })
    saveSession({ folder: { kind: 'remote', location, name: remoteName(location) }, openFile: null })
    emit('ui:folder', describe())
    return describe()
  }

  async function openFolderByID (id) {
    const remote = recentFolders().find((entry) => entry.id === id && entry.kind === 'remote')
    if (remote) return connectToServer(addressOf(remote.location))
    try {
      return await adopt(await Native.openFolder({ id }))
    } catch (error) {
      throw new StoreError(error?.code ?? 'failed', error?.message ?? 'That folder could not be opened.')
    }
  }

  /**
   * ⌘O, and the folder button. iOS names a folder two ways — the system picker, or the app's
   * own — and the recent folders are the third, so all three are one menu rather than a picker
   * with a list hidden somewhere else.
   */
  async function openFolder () {
    const recents = recentFolders().filter((entry) =>
      entry.id !== APP_FOLDER && entry.id !== store?.identity)
    const choices = [
      { title: 'Choose Folder…', run: pickFolder },
      { title: ANDROID ? 'On This Device ▸ LoText' : `On My ${deviceName()} ▸ LoText`, run: () => openFolderByID(APP_FOLDER) },
      // The sheet is the model's, as ⇧⌘K's is on the Mac; this only asks for it.
      ...(ANDROID ? [] : [
        { title: 'Connect to Server…', run: () => { emit('menu:command', { command: 'connectToServer' }); return null } },
      ]),
      ...titled(recents).map(({ entry, title }) => ({ title, run: () => openFolderByID(entry.id) })),
    ]
    const index = await chooseFrom(choices, { title: 'Open Folder' })
    if (index < 0) return null
    return choices[index].run()
  }

  async function pickFolder () {
    const picked = await Native.pickFolder()
    if (!picked?.id) return null
    return adopt(picked)
  }

  /**
   * The name a document's position is filed under. A folder picked in iCloud Drive has a path
   * under `Mobile Documents`, as it does on the Mac, so the two devices file it the same way.
   */
  function documentKey (file) {
    const current = withStore()
    if (current.kind === 'remote') return `ssh:${current.identity}/${file}`
    return current.rootPath
      ? positionKey(`${current.rootPath}/${file}`)
      : `local:${current.identity}/${file}`
  }

  // MARK: - The lists the app keeps

  function recentFolders () {
    const list = prefs.get(RECENTS_KEY, [])
    return Array.isArray(list) ? list : []
  }

  function rememberFolder (entry) {
    const list = recentFolders().filter((item) => item.id !== entry.id)
    list.unshift(entry)
    prefs.set(RECENTS_KEY, list.slice(0, MAX_RECENTS))
  }

  /** Two folders called `docs` are told apart by where each one is. */
  function titled (list) {
    const counts = new Map()
    for (const entry of list) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1)
    return list.map((entry) => ({
      entry,
      title: counts.get(entry.name) > 1 && entry.detail ? `${entry.name} — ${entry.detail}` : entry.name,
    }))
  }

  function saveSession (patch) {
    prefs.set(SESSION_KEY, { ...prefs.get(SESSION_KEY, {}), ...patch })
  }

  // MARK: - The viewers

  async function loadForViewer (file, viewer) {
    const current = withStore()
    if (current.kind === 'remote') return loadRemoteForViewer(current, file, viewer)
    if (viewer === 'media') {
      const { url } = await Native.fileURL({ path: file })
      return { kind: 'file', url: window.Capacitor?.convertFileSrc?.(url) ?? url }
    }
    if (viewer === 'pdf') {
      // WebKit on iOS draws only the first page of a PDF in a frame; Quick Look draws them all.
      if (!await current.exists(file)) throw notFound(file)
      return { kind: 'pdf', quickLook: true }
    }
    const { data } = await current.read(file)
    if (viewer === 'image') return { kind: 'image', dataURL: dataURL(data, mimeFor(file)) }
    const document = await extract(data, FilePath.name(file), inflateRaw)
    if (document.kind === 'image') return { kind: 'image', dataURL: dataURL(document.data, document.mime) }
    return document
  }

  /** A server's file has no URL here: everything is built from its bytes. */
  async function loadRemoteForViewer (current, file, viewer) {
    const { data } = await current.read(file)
    if (viewer === 'pdf') return { kind: 'pdf', quickLook: true }
    if (viewer === 'media') return { kind: 'file', url: dataURL(data, mimeFor(file)) }
    if (viewer === 'image') return { kind: 'image', dataURL: dataURL(data, mimeFor(file)) }
    const document = await extract(data, FilePath.name(file), inflateRaw)
    if (document.kind === 'image') return { kind: 'image', dataURL: dataURL(document.data, document.mime) }
    return document
  }

  // MARK: - The bridge

  const bridge = {
    platform: PLATFORM,

    // The folder
    openFolder,
    adoptFolder: (id) => openFolderByID(id),
    connectToServer,
    describeFolder: async () => describe(),
    refreshAvailability: async () => {
      const current = withStore()
      await current.refreshAvailability()
      return current.isUnavailable
    },
    saveExpansion: async (paths) => {
      if (!store) return true
      const all = { ...prefs.get(EXPANSION_KEY, {}) }
      if (paths.length) all[store.identity] = paths
      else delete all[store.identity]
      prefs.set(EXPANSION_KEY, all)
      return true
    },

    // The one door
    children: async (folder) => withStore().children(folder),
    readText: async (file) => {
      const { data, stamp } = await withStore().read(file)
      const { text, lineEnding } = decode(data, file)
      return { text, lineEnding, stamp }
    },
    writeText: async (file, text, lineEnding, expected) =>
      withStore().write(encode(text, lineEnding), file, expected ?? null),
    stamp: async (file) => withStore().stamp(file),
    /** The way out when a file cannot be saved where it lives: the system's export picker. */
    saveCopyAs: async (name, text, lineEnding) => {
      const { name: saved } = await Native.exportFile({ name, data: toBase64(encode(text, lineEnding)) })
      return saved ?? null
    },
    exists: async (file) => withStore().exists(file),
    create: async (kind, name, parent) => withStore().create(kind, name, parent),
    rename: async (file, name) => withStore().rename(file, name),
    move: async (file, destination) => withStore().move(file, destination),
    duplicate: async (file) => withStore().duplicate(file),
    remove: async (file, options) => withStore().delete(file, options),
    reveal: async () => false,
    copyAbsolutePath: async () => false,
    openLinkAsFolder: async () => null,
    // A wiki link to a web address. Capacitor hands both on to the system: iOS opens a
    // `window.open` in Safari, Android launches any navigation off the app's own host as a view
    // intent, so the page itself never leaves.
    openExternal: async (address) => {
      const url = new URL(String(address))
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw new Error('Only web and mail addresses open from a link.')
      if (PLATFORM === 'android') window.location.assign(url.href)
      else window.open(url.href, '_blank')
      return true
    },

    // The viewers
    loadForViewer,
    /** iOS only: a PDF in Quick Look, which pages and zooms it. */
    quickLook: async (file) => {
      const current = withStore()
      if (current.kind !== 'remote') return Native.quickLook({ path: file })
      // A server's PDF is handed over as bytes, for a copy Quick Look can open.
      const { data } = await current.read(file)
      return Native.quickLook({ name: FilePath.name(file), data: toBase64(data) })
    },

    // Finding a file by name
    startWalk: async (token) => {
      const current = withStore()
      walkToken = token
      await walk(current,
        (batch) => emit('search:batch', { token, ...batch }),
        () => walkToken !== token)
      emit('search:done', { token })
      return true
    },
    cancelWalk: async () => { walkToken = null; return true },
    onSearchBatch: (listener) => on('search:batch', listener),
    onSearchDone: (listener) => on('search:done', listener),

    // Recently edited files
    recentlyEdited: async (token) => {
      const current = withStore()
      recentToken = token
      return recentlyEdited(current, () => recentToken !== token)
    },
    cancelRecentlyEdited: async () => { recentToken = null; return true },

    // The working save
    writeRecovery: (file, text) => Recovery.write(store?.identity ?? '', file, text),
    readRecovery: (file, diskText) => Recovery.read(store?.identity ?? '', file, diskText),
    discardRecovery: (file) => Recovery.discard(store?.identity ?? '', file),

    // Settings
    readSettings: async () => settings.read(),
    setView: async (patch) => { settings.setView(patch); return settings.read() },
    restoreViewDefaults: async () => { settings.restoreViewDefaults(); return settings.read() },
    selectPreset: async (id) => { settings.selectPreset(id); return settings.read() },
    updatePreset: async (patch) => { settings.updateActivePreset(patch); return settings.read() },
    addPreset: async (kind) => { settings.addPreset(kind); return settings.read() },
    duplicatePreset: async () => { settings.duplicateActivePreset(); return settings.read() },
    renamePreset: async (name) => { settings.renameActivePreset(name); return settings.read() },
    deletePreset: async () => { settings.deleteActivePreset(); return settings.read() },
    restorePrintDefaults: async () => { settings.restorePrintDefaults(); return settings.read() },
    exportSettings: async () => {
      const text = JSON.stringify(settings.exportable(), null, 2) + '\n'
      const { name } = await Native.exportFile({
        name: 'LoText Settings.json',
        data: toBase64(new TextEncoder().encode(text)),
      })
      return name ? { ok: true, name } : { ok: false, canceled: true }
    },
    importSettings: async () => {
      const picked = await Native.importFile({ types: ['public.json'] })
      if (!picked?.data) return { ok: false, canceled: true }
      let data
      try {
        data = JSON.parse(new TextDecoder().decode(fromBase64(picked.data)))
      } catch (error) {
        return { ok: false, reason: `That file is not readable JSON (${error.message}).` }
      }
      const result = settings.importFrom(data)
      return result.ok ? { ...result, settings: settings.read(), name: picked.name } : result
    },
    openSettings: async () => { emit('ui:settings'); return true },
    cloudStatus: async () => cloud.status(),
    setCloudSync: async (on) => cloud.setEnabled(Boolean(on)),
    onCloudStatus: (listener) => on('cloud:status', listener),

    // Where each document was left
    readPosition: async (file) => cloud.position(documentKey(file)),
    savePosition: async (file, position) => { cloud.rememberPosition(documentKey(file), position); return true },

    setSettingsTitle: async (title) => { emit('ui:settingsTitle', title); return true },
    /** ⌘+ / ⌘− / ⌘0, which on the Mac are the View menu's own. */
    stepFontSize: async (delta) => { settings.stepFontSize(delta); return settings.read() },
    resetFontSize: async () => { settings.resetFontSize(); return settings.read() },

    // The lists the app keeps
    recentFolders: async () => titled(recentFolders()),
    openRecentFolder: async (id) => openFolderByID(id),
    forgetRecentFolder: async (id) => {
      const entry = recentFolders().find((item) => item.id === id)
      prefs.set(RECENTS_KEY, recentFolders().filter((item) => item.id !== id))
      if (id !== APP_FOLDER && entry?.kind !== 'remote') await Native.forgetFolder({ id }).catch(() => {})
      return true
    },
    clearRecentFolders: async () => { prefs.set(RECENTS_KEY, []); return true },
    recentServers: async () => cloud.servers(),
    publicKey: async () => publicKey(deviceName()),
    copyToClipboard: async (text) => { await navigator.clipboard?.writeText(text); return true },
    performEdit: async (action) => document.execCommand(action),

    // Cut and Send to DayCap. The folder is this device's own, a bookmark the native side keeps,
    // so what the settings panel shows is its name alone.
    sendsToDayCap: !ANDROID,
    dayCapFolder: async () => (await Native.dayCapFolder()).name ?? null,
    chooseDayCapFolder: async () => (await Native.pickDayCapFolder()).name ?? null,
    sendToDayCap: (text) => sendToDayCap(dayCapNative, text),

    // Printing
    print: async ({ text, fileName }) => printJob({ text, fileName }, false),
    /** iOS only: the same pages, as a PDF handed to the share sheet. */
    sharePDF: async ({ text, fileName }) => printJob({ text, fileName }, true),

    // The window. There is one, and it is always there.
    setTitle: async () => true,
    noteOpenFile: async (file) => { saveSession({ openFile: file ?? null }); return true },
    newWindow: async () => true,
    closeWindow: async () => true,
    windowSettled: async () => true,
    holdClose: async () => true,
    cancelClose: async () => true,
    /**
     * The folder and file that were open when the app last went away. A first launch has none,
     * and opens the app's own folder, so the first screen is a folder rather than a button.
     */
    restoreRecord: async () => {
      if (restoreTaken) return null
      restoreTaken = true
      return restoreRecord
    },
    queueClaims: async () => false,
    ready: () => {},
    ask: async (options) => {
      const { index } = await Native.alert({
        title: options.title ?? '',
        message: options.message ?? '',
        buttons: options.buttons,
        cancelIndex: options.cancelId ?? -1,
      })
      return index
    },
    quit: async () => true,

    // What the menu needs to know. iOS has no menu bar; the bars in src/mobile/ui.js read the
    // model directly, and commands arrive from them and from a hardware keyboard.
    reportMenuState: () => {},
    rebuildMenu: () => {},
    onMenuCommand: (listener) => on('menu:command', listener),
    sendCommand: (command, payload) => emit('menu:command', { command, payload }),
    onFolderChanged: (listener) => on('folder:changed', listener),
    onSettingsChanged: (listener) => settings.onChange(listener),
    onThemeChanged: () => () => {},
    onOpenFile: (listener) => on('app:openFile', listener),
    onSettle: () => () => {},

    // For src/mobile/ui.js
    on,
    emit,
    flushPreferences: () => prefs.flush(),
  }

  async function printJob ({ text, fileName }, share) {
    const preset = settings.activePreset()
    return printDocument({
      text,
      fileName,
      folderName: store?.rootName ?? '',
      settings: settings.printSnapshot(preset),
      paper: preset.paper ?? 'letter',
    }, { share })
  }

  if (ANDROID) {
    delete bridge.cloudStatus
    delete bridge.setCloudSync
    delete bridge.onCloudStatus
  }

  // Everything but the listeners waits for the preferences to be read, so nothing is answered
  // from an empty file on the way up.
  for (const [key, value] of Object.entries(bridge)) {
    if (typeof value !== 'function' || key.startsWith('on') || key === 'emit' ||
        key === 'sendCommand' || key === 'ready' || key === 'reportMenuState' || key === 'rebuildMenu') continue
    bridge[key] = async (...args) => { await ready; return value(...args) }
  }

  // View ▸ Show Hidden Files: every listing follows the setting, and follows a change to it.
  settings.onChange((state) => setHiddenFilesShown(state.view.showHiddenFiles))

  ready.then(() => {
    setHiddenFilesShown(settings.view().showHiddenFiles)
    watchCloud(cloud)
    cloud.refresh()
    const session = prefs.get(SESSION_KEY, null)
    restoreRecord = session?.folder
      ? { folder: session.folder, openFile: session.openFile ?? null }
      : { folder: { kind: 'local', path: APP_FOLDER, name: 'LoText' }, openFile: null }
  })

  return bridge
}

// MARK: - Helpers

/** Zip entries inflated by the platform's own decompressor. */
async function inflateRaw (bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function dataURL (bytes, mime) {
  return `data:${mime};base64,${toBase64(bytes)}`
}

function mimeFor (file) {
  const extension = FilePath.name(file).replace(/^.*\./, '').toLowerCase()
  return {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    tiff: 'image/tiff',
    heic: 'image/heic',
  }[extension] ?? 'application/octet-stream'
}

function deviceName () {
  return /iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
    ? 'iPad'
    : 'iPhone'
}

/** A preset's id. `crypto.randomUUID` needs a secure context, which the app's scheme may not be. */
function newID () {
  if (globalThis.crypto?.randomUUID) {
    try { return crypto.randomUUID() } catch {}
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
