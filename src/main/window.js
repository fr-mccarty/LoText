// One window is one folder. A second folder is a second window (⌥⌘N); ⌘N makes a file.
//
// The window owns the store for its folder, because the store is the one thing that has to
// live next to the file system. Everything else about a window — its tree, its open file, its
// history — belongs to the model in the renderer, which is where the app actually is.

import path from 'node:path'
import { BrowserWindow, app } from 'electron'
import { LocalStore } from './store/local-store.js'
import { RemoteStore } from './store/remote-store.js'
import * as Session from './session.js'
import { identity as remoteIdentity, displayName as remoteName, target } from '../shared/store/remote-location.js'

const windows = new Map()

export function allWindows () {
  return [...windows.values()]
}

export function forWebContents (contents) {
  const browser = BrowserWindow.fromWebContents(contents)
  return browser ? windows.get(browser.id) : null
}

export function focused () {
  const browser = BrowserWindow.getFocusedWindow()
  return browser ? windows.get(browser.id) : null
}

/** The window in front, or — with none in front — any window at all, so a menu still lands. */
export function frontOrAny () {
  return focused() ?? allWindows()[0] ?? null
}

class AppWindow {
  constructor (browser, restore) {
    this.browser = browser
    this.store = null
    this.restore = restore ?? null            // a session record this window should adopt
    this.isSettling = false
    this.hasSettled = false
  }

  get id () { return this.browser.id }

  get folderKey () { return this.store?.identity ?? null }

  send (channel, payload) {
    if (this.browser.isDestroyed()) return
    this.browser.webContents.send(channel, payload)
  }

  /**
   * Gives the window a folder, closing whatever it had. The store starts watching at once —
   * for a folder on this machine; a folder on a server has nothing watching it, and ⌘R is
   * what replaces the watcher there.
   */
  async adopt (store) {
    this.releaseStore()
    this.store = store
    store.startWatching?.(() => this.send('folder:changed'))
    return this.describeFolder()
  }

  describeFolder () {
    if (!this.store) return null
    return {
      key: this.store.identity,
      name: this.store.rootName,
      kind: this.store.kind,
      capabilities: this.store.capabilities,
      isUnavailable: this.store.isUnavailable,
      expansion: Session.expansion(this.store.identity),
    }
  }

  releaseStore () {
    this.store?.close?.()
    this.store = null
  }

  destroy () {
    this.releaseStore()
    windows.delete(this.id)
  }
}

export function createWindow ({ restore = null, show = true } = {}) {
  const browser = new BrowserWindow({
    width: restore?.bounds?.width ?? 1040,
    height: restore?.bounds?.height ?? 720,
    x: restore?.bounds?.x,
    y: restore?.bounds?.y,
    minWidth: 680,
    minHeight: 420,
    show: false,
    // Nothing is drawn above the editor: no tab bar, no strip repeating the open file's name,
    // no rule, no hairline, no separator. The title bar is a strip of the window rather than a
    // bar sitting on top of one — and the traffic lights stay visible, always, because a
    // window control you have to find by hovering is one you cannot see to aim at.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 13, y: 16 },
    // No tabs of any kind. A second folder is a second *window*.
    tabbingIdentifier: undefined,
    backgroundColor: '#00000000',
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  // macOS would otherwise offer to merge two windows into one tabbed window.
  if (browser.setTabbingIdentifier) browser.setTabbingIdentifier(null)

  const entry = new AppWindow(browser, restore)
  windows.set(browser.id, entry)

  browser.loadFile(path.join(__dirname, 'index.html'))
  browser.once('ready-to-show', () => { if (show) browser.show() })

  // Closing saves. The renderer is asked to settle its buffer first, and the window waits for
  // the answer — a save that cannot go through is exactly the case this exists for.
  browser.on('close', (event) => {
    if (entry.hasSettled) return
    event.preventDefault()
    if (entry.isSettling) return
    entry.isSettling = true
    entry.send('window:settle')
    // A renderer that never answers must not strand a window on screen forever.
    // Held while the renderer is asking the user something: a question on screen is an answer
    // on its way, not a renderer that has stopped answering.
    setTimeout(() => {
      if (!browser.isDestroyed() && entry.isSettling && !entry.closeHeld) finishClose(entry)
    }, 4000)
  })

  browser.on('closed', () => entry.destroy())

  return entry
}

/** The renderer has finished saving; let the close through. */
export function finishClose (entry) {
  entry.isSettling = false
  entry.closeHeld = false
  entry.hasSettled = true
  // A window closed before the quit is not reopened, so its record goes now.
  if (!entry.browser.isDestroyed()) entry.browser.close()
}

/** The user chose to keep editing: the window stays, and the next close asks again. */
export function cancelClose (entry) {
  entry.isSettling = false
  entry.closeHeld = false
}

/**
 * Each window's folder and open file, so a quit with two windows relaunches with two. What a
 * window had open is forgotten when that window closes, and never before.
 */
export function collectSessions () {
  return allWindows()
    .filter((entry) => entry.store)
    .map((entry) => ({
      folder: entry.store.kind === 'remote'
        ? { kind: 'remote', location: entry.store.location, name: remoteName(entry.store.location), detail: target(entry.store.location) }
        : { kind: 'local', path: entry.store.root, name: entry.store.rootName },
      openFile: entry.lastOpenFile ?? null,
      bounds: entry.browser.isDestroyed() ? null : entry.browser.getBounds(),
    }))
}

// MARK: - Making a store

export async function localStoreFor (folder) {
  const store = new LocalStore(folder)
  await store.refreshAvailability()
  return store
}

export async function remoteStoreFor (location) {
  const store = new RemoteStore(location)
  await store.connect()
  return store
}

export function recentEntryFor (store) {
  if (store.kind === 'remote') {
    return {
      id: remoteIdentity(store.location),
      kind: 'remote',
      name: remoteName(store.location),
      detail: target(store.location),
      location: store.location,
    }
  }
  return { id: store.root, kind: 'local', name: store.rootName, detail: path.dirname(store.root) }
}

export function quitWhenLastWindowCloses () {
  return process.platform !== 'darwin' ? true : windows.size === 0
}

export { app }
