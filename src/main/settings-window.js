// The Settings panel (⌘,) — one window, two tabs, and only ever one of it.
//
// Two tabs, each bound to its own bag: nothing on one tab can read or write the other's
// storage. A window rather than a sheet because it belongs to the app and not to any one
// folder, and because a preset list is something people leave open while they print.

import path from 'node:path'
import { BrowserWindow } from 'electron'
import { chromeOptions } from './chrome.js'

let panel = null

export function openSettingsWindow () {
  if (panel && !panel.isDestroyed()) {
    panel.show()
    panel.focus()
    return panel
  }
  panel = new BrowserWindow({
    width: 620,
    height: 760,
    minWidth: 520,
    minHeight: 480,
    title: 'Editor',
    ...chromeOptions('window'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  // The document's own <title> would win over the tab's name the moment the page loaded, and
  // again on every reload; the renderer says what this window is called.
  panel.on('page-title-updated', (event) => event.preventDefault())
  panel.loadFile(path.join(__dirname, 'settings.html'))
  panel.once('ready-to-show', () => panel.show())
  panel.on('closed', () => { panel = null })
  return panel
}

export function settingsWindow () {
  return panel && !panel.isDestroyed() ? panel : null
}
