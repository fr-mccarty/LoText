// LoText — a folder-based plain-text editor.
//
// One window is one folder. One file is open at a time per window. There are no tabs, no
// markdown preview, no syntax highlighting, no split view: the app opens a folder, edits the
// files in it as plain text, and prints them.
//
// The launch path is short on purpose: register the handlers, build the menu, and put back the
// windows that were open at the last quit. Everything else happens because a window asked for
// it.

import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import * as prefs from './prefs.js'
import * as Settings from './settings.js'
import * as Session from './session.js'
import * as Windows from './window.js'
import * as Cloud from './cloud.js'
import { registerHandlers } from './ipc.js'
import { buildMenu, updateMenuState } from './menu.js'
import { followThemeOutsideMac } from './chrome.js'
import { enqueue, deliver, claimsWithin } from './open-queue.js'
import { filesFromArgv } from './argv-files.js'
import { runCommandLine, isCommandLineJob } from './cli.js'
import { statSync } from 'node:fs'
import { setHiddenFilesShown } from '../shared/store/names.js'

app.setName('LoText')

// A single instance, so a second launch hands its files to the app already running rather
// than starting a second copy with its own idea of which windows are open.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  main()
}

function main () {
  // Files can arrive before `ready`, which is the whole reason the queue exists.
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    enqueue(filePath)
  })

  app.on('second-instance', (_event, argv) => {
    for (const file of documentArguments(argv)) enqueue(file)
    Windows.frontOrAny()?.browser.focus()
  })

  app.whenReady().then(async () => {
    // `lotext --pdf notes.md --out notes.pdf` is the same printer with no window: it exits
    // before there is a folder or a Dock icon.
    if (isCommandLineJob(process.argv)) {
      // The status is the whole point of a command line: 0 for a PDF written, 1 for anything
      // that stopped it — so a shell script can tell, as it can with Lolext.
      let status
      try {
        status = await runCommandLine(process.argv)
      } catch (error) {
        process.stderr.write(`${error.message}\n`)
        status = 1
      }
      app.exit(status)
      return
    }

    // View ▸ Show Hidden Files decides what every listing shows, before any window lists one.
    setHiddenFilesShown(Settings.view().showHiddenFiles)
    registerHandlers()
    registerRendererEvents()
    buildMenu()
    restoreWindows()

    // After the windows, never before: queueing first would find nothing ready to take the file
    // and ask for a window of its own, on top of the ones being restored. The restored windows
    // call in as they finish, and the queue hands the file to whichever one should have it.
    for (const file of documentArguments(process.argv)) enqueue(file)

    // The settings panel and every open window follow a changed setting without being
    // reopened, which is what makes ⌘+ feel like it belongs to the text.
    Settings.onChange((state) => {
      // Ahead of the windows hearing of it, so the listing they ask for next follows it.
      setHiddenFilesShown(state.view.showHiddenFiles)
      buildMenu()
      for (const browser of BrowserWindow.getAllWindows()) {
        browser.webContents.send('settings:changed', state)
      }
    })

    // iCloud, when it is on: read what the other devices wrote, and again whenever the app
    // comes forward.
    Cloud.start()

    followThemeOutsideMac()
    nativeTheme.on('updated', () => {
      for (const browser of BrowserWindow.getAllWindows()) {
        browser.webContents.send('theme:changed', nativeTheme.shouldUseDarkColors)
      }
    })

    app.on('activate', () => {
      if (!Windows.allWindows().length) Windows.createWindow()
    })
  })

  // Closing the last window quits the app; closing one of several closes one of several.
  app.on('window-all-closed', () => {
    Session.saveWindowSessions(pendingSessions)
    prefs.flush()
    app.quit()
  })

  app.on('before-quit', () => {
    pendingSessions = Windows.collectSessions()
    Session.saveWindowSessions(pendingSessions)
    prefs.flush()
  })

  // The windows note where each document was left as they close, which is after
  // `before-quit`; the iCloud file with those positions in it is written before the app goes.
  let cloudWritten = false
  app.on('will-quit', (event) => {
    prefs.flush()
    if (cloudWritten || !Cloud.cloud.pending()) return
    cloudWritten = true
    event.preventDefault()
    Cloud.cloud.flush().finally(() => app.quit())
  })
}

/** The last picture of the open windows, taken before they start going away. */
let pendingSessions = []

/** The files named on a command line — this app's own, or a second launch's. */
function documentArguments (argv) {
  return filesFromArgv(argv, {
    isPackaged: app.isPackaged,
    exists: (candidate) => {
      try {
        return statSync(candidate).isFile()
      } catch {
        return false
      }
    },
  })
}

/**
 * A quit with two folders open in two windows relaunches with two, each with its folder and
 * its open file. A window closed before the quit is not reopened.
 */
function restoreWindows () {
  const sessions = Session.windowSessions()
  if (!sessions.length) {
    Windows.createWindow()
    deliver()
    return
  }
  for (const record of sessions) {
    Windows.createWindow({ restore: record })
  }
}

function registerRendererEvents () {
  // Pushed whenever what the window in front can do changes, so the menu is never offering
  // something that would land on nothing.
  ipcMain.on('menu:state', (event, patch) => {
    const entry = Windows.forWebContents(event.sender)
    if (entry && BrowserWindow.fromWebContents(event.sender)?.isFocused() !== false) {
      updateMenuState(patch)
    }
  })

  // A window says when it has finished restoring; until then it cannot be handed a file.
  ipcMain.on('window:ready', (event) => {
    const entry = Windows.forWebContents(event.sender)
    if (!entry) return
    entry.isReady = true
    deliver()
  })

  // A window restoring its session reads the queue before reopening the file it remembers: if
  // something is on its way in that this folder holds, both want the one editor and only one
  // of them was just double-clicked.
  ipcMain.handle('open-queue:claims', (event, folder) => claimsWithin(folder))

  ipcMain.on('menu:rebuild', () => buildMenu())
}

