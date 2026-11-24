// The window, assembled. Everything below this line is a view; everything the views ask for is
// on the model, and everything the model asks for is on the one bridge to the file system.

import { AppModel } from './model.js'
import { Editor } from './editor/editor.js'
import { Sidebar } from './sidebar/sidebar.js'
import { DetailPane } from './detail.js'
import { FindFileSheet } from './sheets/find-file.js'
import { RecentFilesSheet } from './sheets/recent-files.js'
import { ConnectSheet } from './sheets/connect.js'
import { HelpSheet, HELP_TOPICS } from './sheets/help.js'
import { clear } from './dom.js'
import { attachEditorMenu } from './editor/editor-menu.js'
import { restoringErrors } from './bridge-errors.js'
import { markPlatform } from './platform.js'

const bridge = restoringErrors(window.lotext)
markPlatform()
const model = new AppModel(bridge)

const sidebarNode = document.getElementById('sidebar')
const detailNode = document.getElementById('detail')
const sheetHost = document.getElementById('sheet-host')
const splitter = document.getElementById('splitter')

const sidebar = new Sidebar(sidebarNode, model)
const detail = new DetailPane(detailNode, model)

model.editor = new Editor(detail.editorHost, {
  onChange: () => model.bufferDidChange(),
  onSelectionChange: () => model.noteKeyboardLocation(),
  onRequestLink: (at) => model.requestLink(at),
  onFollowLink: (target) => model.followLink(target),
  onOpenAddress: (address) => model.openAddress(address),
})
attachEditorMenu(model.editor, model, bridge)

let openSheet = null

model.subscribe((what) => {
  if (what === 'sheet') { renderSheet(); return }
  if (what === 'notice') { detail.renderNotice(); return }
  if (what === 'settings') {
    model.editor.apply(model.settings.view)
    detail.render()
    return
  }
  if (what === 'layout') { applyLayout(); return }
  sidebar.render()
  detail.render()
  renderSheet()
})

function applyLayout () {
  document.body.classList.toggle('sidebar-hidden', !model.sidebarVisible)
}

// MARK: - Sheets

function renderSheet () {
  if (!model.sheet) {
    // Only as a sheet actually closes: this runs on every redraw, and focusing the editor each
    // time pulled the keyboard out of the sidebar the moment a clicked file opened.
    const wasShowing = openSheet !== null
    openSheet?.dispose?.()
    openSheet = null
    sheetHost.hidden = true
    clear(sheetHost)
    // The keyboard goes back to whatever was being edited, rather than nowhere.
    if (wasShowing && model.openFile) model.editor.focus()
    return
  }
  if (openSheet?.name !== model.sheet) {
    openSheet?.dispose?.()
    clear(sheetHost)
    openSheet = makeSheet(model.sheet)
    openSheet.name = model.sheet
    sheetHost.append(openSheet.build())
    sheetHost.hidden = false
  } else {
    openSheet.render?.()
  }
}

function makeSheet (name) {
  if (name === 'findFile') return new FindFileSheet(model)
  if (name === 'linkFile') {
    return new FindFileSheet(model, { under: model.linkFolder, onChoose: (path) => model.chooseLink(path) })
  }
  if (name === 'recentFiles') return new RecentFilesSheet(model)
  if (HELP_TOPICS[name]) return new HelpSheet(model, name)
  return new ConnectSheet(model)
}

// A click on the dimmed backdrop puts the sheet away and changes nothing.
sheetHost.addEventListener('mousedown', (event) => {
  if (event.target === sheetHost) model.closeSheet()
})

// MARK: - The split

let isDragging = false
splitter.addEventListener('mousedown', () => { isDragging = true; document.body.classList.add('dragging') })
window.addEventListener('mousemove', (event) => {
  if (!isDragging) return
  const width = Math.min(Math.max(180, event.clientX), 460)
  document.documentElement.style.setProperty('--sidebar-width', `${width}px`)
})
window.addEventListener('mouseup', () => { isDragging = false; document.body.classList.remove('dragging') })

// MARK: - Keys that belong to no menu

document.addEventListener('focusin', () => model.noteKeyboardLocation())
document.addEventListener('focusout', () => setTimeout(() => model.noteKeyboardLocation(), 0))

// ⌘X reaches the editor's own cut, which takes the whole line when nothing is selected. The
// menu leaves it to the focused element, so the editor claims it only when the editor has the
// keyboard.
document.addEventListener('keydown', (event) => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return
  if (event.key === 'x' && model.editor.isFocused) {
    event.preventDefault()
    model.editor.cut()
  }
}, true)

// MARK: - Go

// A platform's own chrome — on iOS the bars, the keyboard bar and the touch menus
// (src/mobile/ui.js) — is handed the window's parts before anything is drawn. The Mac has none.
window.lotextShell?.({ model, sidebar, detail })

applyLayout()
window.__model = model
model.start()
