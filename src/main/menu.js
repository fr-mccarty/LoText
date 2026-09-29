// Every menu command, each disabled when it does not apply, and every one of them aimed at
// the window in front.
//
// ⌘N still makes a *file*, which is why New Window is ⌥⌘N: the thing this app makes most often
// keeps the shortcut that makes it. **There is no Window ▸ Merge All Windows and no Tabs menu**
// — one file is open at a time, and a second folder is a second window.
//
// ⌘P prints, which is where the platform has put it since before this app existed and where it
// is staying: it was lent to Find File for a while and has been taken back. Find File is ⇧⌘P,
// the key the editors that have a command palette put it on. ⌘B stayed with Bold — the sidebar
// toggle asked for ⇧⌘B, which is the other key that means it.
//
// ⌘F is the other search, and the two are deliberately different things: ⌘F looks through the
// text of the file that is open, ⇧⌘P looks through the *names* of every file in the folder.
//
// The delete keys are split, and not by preference. Plain ⌫ is handled in the sidebar itself,
// where it can only fire when the sidebar has focus — as a menu item it would swallow every
// backspace typed into the editor. ⌘⌫ **has to be one**, so it is here, and it **routes**: it
// asks, at the moment of the press, whether the keyboard is in text. In the editor's buffer or
// in a name being typed it deletes to the beginning of the line, and the item renames itself to
// say so; everywhere else it deletes the highlighted row, immediately, without asking.
//
// The item stays **enabled in both cases**, and that is the part worth reading twice. Gating it
// on focus is how this key once did nothing at all: a disabled menu item does not hand its key
// equivalent back, it swallows it, so the text view never saw ⌘⌫ either.

import { Menu, app } from 'electron'
import * as Windows from './window.js'
import * as Session from './session.js'
import * as Settings from './settings.js'
import { openSettingsWindow, settingsWindow } from './settings-window.js'
import * as SettingsFile from './settings-file.js'

/**
 * What the window in front can currently do. Pushed by the renderer whenever it changes, so
 * the menu is never offering something that would land on nothing.
 */
let state = {
  hasFolder: false,
  hasOpenFile: false,
  canDuplicate: false,
  canPrint: false,
  isEditingText: false,
  hasSelection: false,
}

export function updateMenuState (patch) {
  const next = { ...state, ...patch }
  const changed = Object.keys(next).some((key) => next[key] !== state[key])
  state = next
  if (changed) buildMenu()
}

function send (command, payload) {
  Windows.frontOrAny()?.send('menu:command', { command, payload })
}

export function buildMenu () {
  Menu.setApplicationMenu(Menu.buildFromTemplate(template()))
}

function template () {
  return [
    appMenu(),
    fileMenu(),
    editMenu(),
    formatMenu(),
    viewMenu(),
    windowMenu(),
    helpMenu(),
  ]
}

function appMenu () {
  return {
    label: app.name,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'Command+,', click: () => openSettingsWindow() },
      // The same two buttons as the Settings File group at the foot of either tab, here as well
      // so that moving settings to another Mac does not start with a hunt through the panel.
      { label: 'Export Settings…', click: () => SettingsFile.exportSettingsFromMenu(settingsWindow() ?? Windows.frontOrAny()?.browser) },
      { label: 'Import Settings…', click: () => SettingsFile.importSettingsFromMenu(settingsWindow() ?? Windows.frontOrAny()?.browser) },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  }
}

function fileMenu () {
  return {
    label: 'File',
    submenu: [
      // An empty window, for a second folder. It opens with no folder rather than a copy of
      // this one: two windows on the same folder would be two trees and two buffers over one
      // set of files.
      { label: 'New Window', accelerator: 'Alt+Command+N', click: () => Windows.createWindow() },
      { type: 'separator' },
      { label: 'New File', accelerator: 'Command+N', enabled: state.hasFolder, click: () => send('newFile') },
      { label: 'New Folder', accelerator: 'Shift+Command+N', enabled: state.hasFolder, click: () => send('newFolder') },
      // The platform's own ⌘D was not available: ⌘D is Select Next Instance, which is reached
      // far more often than this is. ⇧⌘D is the other key that means duplicate, and it was free.
      { label: 'Duplicate', accelerator: 'Shift+Command+D', enabled: state.canDuplicate, click: () => send('duplicate') },
      { type: 'separator' },
      { label: 'Open Folder…', accelerator: 'Command+O', click: () => send('openFolder') },
      // A folder on another machine, opened over SSH and edited in place. ⇧⌘K is the key the
      // Finder gives to the same idea, which is the only reason it is this one.
      { label: 'Connect to Server…', accelerator: 'Shift+Command+K', click: () => send('connectToServer') },
      recentFoldersMenu(),
      // Back to what was just being worked on: the files changed most recently on disk. ⇧⌘O
      // beside ⌘O for the reason ⇧⌘N sits beside ⌘N: the same verb over a narrower set.
      { label: 'Recently Edited…', accelerator: 'Shift+Command+O', click: () => send('goToLastFile') },
      // Quick-open. ⇧⌘P rather than ⌘P: a text editor whose ⌘P does not print is a text editor
      // that surprises somebody holding a finished page.
      { label: 'Find File…', accelerator: 'Shift+Command+P', enabled: state.hasFolder, click: () => send('findFile') },
      { type: 'separator' },
      // Declared above the window's own Close so ⌘W closes the file, not the window.
      { label: 'Close File', accelerator: 'Command+W', enabled: state.hasOpenFile, click: () => send('closeFile') },
      { label: 'Close Window', accelerator: 'Shift+Command+W', click: () => Windows.frontOrAny()?.browser.close() },
      { type: 'separator' },
      { label: 'Save', accelerator: 'Command+S', enabled: state.hasOpenFile, click: () => send('save') },
      { type: 'separator' },
      { label: 'Print…', accelerator: 'Command+P', enabled: state.canPrint, click: () => send('print') },
    ],
  }
}

/**
 * App-wide, not per-window: which folders have been worked in is a fact about the person, so a
 * folder opened in the second window is in the first window's menu too. The submenu is
 * disabled when there is nothing in it rather than sitting there empty.
 */
function recentFoldersMenu () {
  const entries = Session.recentFolderTitles()
  return {
    label: 'Recent Folders',
    enabled: entries.length > 0,
    submenu: [
      ...entries.map(({ entry, title }) => ({
        label: title,
        click: () => send('openRecentFolder', entry.id),
      })),
      { type: 'separator' },
      { label: 'Clear Menu', enabled: entries.length > 0, click: () => send('clearRecentFolders') },
    ],
  }
}

function editMenu () {
  return {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      // Cut is the stock item: ⌘X reaches the editor's own cut, which takes the whole line
      // when nothing is selected. The responder chain decides who gets it, rather than the
      // menu hard-wiring one buffer.
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
      { type: 'separator' },
      {
        // The title follows where the keyboard is, so the menu never offers to delete a file
        // and then deletes half a line instead.
        label: state.isEditingText ? 'Delete to Beginning of Line' : 'Delete Immediately',
        accelerator: 'Command+Backspace',
        click: () => send('deleteImmediately'),
      },
      { type: 'separator' },
      { label: 'Select Next Instance', accelerator: 'Command+D', enabled: state.hasOpenFile, click: () => send('selectNextInstance') },
      { type: 'separator' },
      // Listed here so the menu stays the one place every shortcut can be read off, but the key
      // itself is the editor's. A ⌘ shortcut reaches the menu before the page; ⌥↑ does not —
      // the page gets it first, and the text view's own ⌥↑ (to the start of the paragraph)
      // consumed it, so as a registered accelerator it never moved a line at all.
      { label: 'Move Line Up', accelerator: 'Alt+Up', registerAccelerator: false, enabled: state.hasOpenFile, click: () => send('moveLineUp') },
      { label: 'Move Line Down', accelerator: 'Alt+Down', registerAccelerator: false, enabled: state.hasOpenFile, click: () => send('moveLineDown') },
      { type: 'separator' },
      {
        // Find, over the open file. Every item is one call into the editor's own find panel,
        // and the whole feature is a bar the editor already draws. Disabled with nothing open,
        // because there is then no buffer to look through.
        label: 'Find',
        submenu: [
          { label: 'Find…', accelerator: 'Command+F', enabled: state.hasOpenFile, click: () => send('find') },
          { label: 'Find and Replace…', accelerator: 'Alt+Command+F', enabled: state.hasOpenFile, click: () => send('findAndReplace') },
          { label: 'Find Next', accelerator: 'Command+G', enabled: state.hasOpenFile, click: () => send('findNext') },
          { label: 'Find Previous', accelerator: 'Shift+Command+G', enabled: state.hasOpenFile, click: () => send('findPrevious') },
          { label: 'Use Selection for Find', accelerator: 'Command+E', enabled: state.hasOpenFile, click: () => send('useSelectionForFind') },
        ],
      },
    ],
  }
}

/**
 * Markers, not styling: these type `**` and `*` around the selection, and the printer is what
 * later reads them as bold and italic. The editor still draws every line alike.
 */
function formatMenu () {
  return {
    label: 'Format',
    submenu: [
      { label: 'Bold', accelerator: 'Command+B', enabled: state.hasOpenFile, click: () => send('bold') },
      { label: 'Italic', accelerator: 'Command+I', enabled: state.hasOpenFile, click: () => send('italic') },
    ],
  }
}

function viewMenu () {
  return {
    label: 'View',
    submenu: [
      { label: 'Toggle Sidebar', accelerator: 'Shift+Command+B', click: () => send('toggleSidebar') },
      // Asking, for the folders nothing can tell us about. A local folder has a watcher and
      // will rarely need this; a folder on a server has nothing watching it at all, and this
      // is the whole of what replaces the watcher there.
      { label: 'Refresh', accelerator: 'Command+R', enabled: state.hasFolder, click: () => send('refresh') },
      { type: 'separator' },
      // Editor size only — the print size is untouched. Bound to `=` so it fires as ⌘= as well
      // as ⌘⇧=; a literal `+` binding is a shortcut that never fires on a US keyboard, so the
      // shifted spelling is a hidden twin rather than a second menu item.
      { label: 'Bigger', accelerator: 'Command+=', click: bigger },
      { label: 'Bigger', accelerator: 'Shift+Command+=', visible: false, click: bigger },
      { label: 'Smaller', accelerator: 'Command+-', click: smaller },
      { label: 'Actual Size', accelerator: 'Command+0', click: actualSize },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'toggleDevTools', visible: process.argv.includes('--dev') },
    ],
  }
}

function bigger () { Settings.stepFontSize(1) }
function smaller () { Settings.stepFontSize(-1) }
function actualSize () { Settings.resetFontSize() }

/** No Merge All Windows and no tabs: a second folder is a second window. */
function windowMenu () {
  return {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' },
    ],
  }
}

function helpMenu () {
  return {
    role: 'help',
    // All open as sheets in the front window, so they need a window but not a folder.
    submenu: [
      { label: 'Enhanced Tasks', click: () => send('helpTasks') },
      { label: 'Disclosure Arrows', click: () => send('helpDisclosures') },
      { label: 'Markdown Formatting', click: () => send('helpMarkdown') },
    ],
  }
}
