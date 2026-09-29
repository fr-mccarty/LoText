// THE iOS SHELL — what the Mac's window frame, menu bar and mouse are, for a finger.
//
// Everything here is chrome around the Mac's own views: the sidebar, the detail pane, the
// editor and the sheets are the same objects, asking the same model. This file adds what a
// phone lacks and the Mac never needed (specs/mobile.md):
//
//   LAYOUT        width decides — regular shows both panes; compact shows one at a time
//   BARS          a bar on each pane standing in for the menu bar
//   TOUCH         long-press for a row's menu; menus are the system's action sheets
//   KEYBOARD BAR  Tab, ⇧Tab, a task box, bold, italic, undo, redo — above the on-screen keys
//   SHORTCUTS     the Mac's menu keys, for a hardware keyboard
//   SETTINGS      the Mac's panel, in a sheet
//   LIFECYCLE     going to the background is focus loss; coming back is coming forward

import { Keyboard } from '@capacitor/keyboard'
import * as FilePath from '../shared/file-path.js'
import { element, clear, icon, quote } from '../renderer/dom.js'
import { Native, chooseFrom, lastPointer } from './native.js'

/** Narrower than this and the two panes take turns. An iPhone in landscape stays compact. */
const COMPACT_WIDTH = 700

/** How long a finger rests on a row before its menu opens. */
const LONG_PRESS = 450

/** An on-screen keyboard is taller than this; the bar a hardware keyboard leaves is not. */
const SOFT_KEYBOARD = 150

export class MobileShell {
  constructor ({ model, sidebar, detail }, bridge) {
    this.model = model
    this.sidebar = sidebar
    this.detail = detail
    this.bridge = bridge
    this.showingDetail = false
    this.appActive = true
    this.keyboardHeight = 0

    // The model asks whether the window is in front before it raises a question. On iOS that is
    // whether the app is, which the web view's focus does not reliably say.
    Object.defineProperty(model, 'isForeground', { get: () => this.appActive, configurable: true })

    this.buildLayout()
    this.buildSidebarBar()
    this.buildDetailBar()
    this.buildKeyboardBar()
    this.buildSettingsSheet()
    this.watchTouches()
    this.watchKeys()
    this.watchLifecycle()
    this.followNavigation()

    model.subscribe(() => this.render())
    bridge.on('ui:settings', () => this.openSettings())
    bridge.on('ui:settingsTitle', (title) => { if (this.settingsTitle) this.settingsTitle.textContent = title })
    document.addEventListener('lotext:quicklook', (event) => {
      this.bridge.quickLook(event.detail).catch((error) =>
        this.model.alerts.error('That PDF could not be opened.', error.message))
    })
  }

  // MARK: - Layout

  get isCompact () {
    return window.innerWidth < COMPACT_WIDTH
  }

  buildLayout () {
    const apply = () => {
      document.body.classList.toggle('compact', this.isCompact)
      document.body.classList.toggle('showing-detail', this.isCompact && this.showingDetail)
    }
    window.addEventListener('resize', apply)
    this.applyLayout = apply
    apply()

    // The split, for a finger as well as a pointer. The Mac's own handler listens for the
    // mouse, which a touch never becomes while it is moving.
    const splitter = document.getElementById('splitter')
    splitter.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') return
      splitter.setPointerCapture(event.pointerId)
      const move = (drag) => {
        const width = Math.min(Math.max(220, drag.clientX), Math.min(460, window.innerWidth - 320))
        document.documentElement.style.setProperty('--sidebar-width', `${width}px`)
      }
      const end = () => {
        splitter.removeEventListener('pointermove', move)
        splitter.removeEventListener('pointerup', end)
        splitter.removeEventListener('pointercancel', end)
      }
      splitter.addEventListener('pointermove', move)
      splitter.addEventListener('pointerup', end)
      splitter.addEventListener('pointercancel', end)
    })
  }

  showDetail () {
    if (this.showingDetail) return
    this.showingDetail = true
    this.applyLayout()
  }

  /** Back to the list. Leaving the file saves it, as leaving a file does on the Mac. */
  async showList () {
    this.model.editor?.blur()
    this.showingDetail = false
    this.applyLayout()
    await this.model.saveIfDirty({ allowingPrompts: true })
  }

  /**
   * Opening something slides to it. Every path into the pane goes through `openPath` — the
   * sidebar, Find File, Recently Edited — and a new file arrives once it has been named.
   */
  followNavigation () {
    const model = this.model
    const openPath = model.openPath.bind(model)
    model.openPath = async (path, options) => {
      const opened = await openPath(path, options)
      if (opened !== false) this.showDetail()
      return opened
    }
    const commitRename = model.commitRename.bind(model)
    model.commitRename = async (path, proposed) => {
      const wasNew = model.pendingNewFile === path
      await commitRename(path, proposed)
      if (wasNew && model.openFile) this.showDetail()
    }
    // A relaunch comes back to the file that was open, rather than to the list above it.
    const ready = this.bridge.ready
    this.bridge.ready = () => {
      ready()
      if (model.openFile) this.showDetail()
    }
  }

  // MARK: - The bars

  buildSidebarBar () {
    const actions = this.sidebar.root.querySelector('.sidebar-actions')
    const button = (name, title, onClick) => element('button', {
      class: 'icon-button', title, onclick: onClick,
    }, [icon(name, 20)])
    this.findFileButton = button('search', 'Find File', () => this.command('findFile'))
    this.recentButton = button('clock', 'Recently Edited', () => this.command('goToLastFile'))
    const refresh = actions.lastElementChild
    actions.insertBefore(this.findFileButton, refresh)
    actions.insertBefore(this.recentButton, refresh)
    actions.append(button('more', 'More', () => this.appMenu()))
    // The Mac's buttons, drawn at a size a finger can hit.
    for (const svg of actions.querySelectorAll('svg')) {
      svg.setAttribute('width', '20')
      svg.setAttribute('height', '20')
    }

    this.sidebar.presentMenu = (event, items) => this.presentMenu(event, items)
    this.sidebar.extraRowItems = (node) => [{ label: 'Move To…', action: () => this.moveTo(node) }]
  }

  buildDetailBar () {
    const strip = this.detail.dragStrip
    strip.classList.add('mobile-bar')
    this.backButton = element('button', { class: 'bar-button back', onclick: () => this.showList() },
      [icon('back', 22), element('span', { text: 'Files' })])
    this.sidebarButton = element('button', {
      class: 'bar-button sidebar-toggle', title: 'Toggle Sidebar',
      onclick: () => this.command('toggleSidebar'),
    }, [icon('sidebar', 22)])
    this.titleNode = element('div', { class: 'bar-title' })
    this.findButton = element('button', {
      class: 'bar-button', title: 'Find', onclick: () => this.command('find'),
    }, [icon('search', 21)])
    this.moreButton = element('button', {
      class: 'bar-button', title: 'More', onclick: () => this.fileMenu(),
    }, [icon('more', 22)])
    strip.append(
      element('div', { class: 'bar-side leading' }, [this.backButton, this.sidebarButton]),
      this.titleNode,
      element('div', { class: 'bar-side trailing' }, [this.findButton, this.moreButton]))
  }

  render () {
    const model = this.model
    const file = model.openFile
    const name = file?.fileName ?? (model.previewPath ? FilePath.name(model.previewPath) : '')
    clear(this.titleNode)
    this.titleNode.append(element('span', { class: 'bar-title-text', text: name }))
    if (file?.needsAttention) this.titleNode.append(element('span', { class: 'attention' }, [icon('warning', 12)]))
    else if (file?.isDirty) this.titleNode.append(element('span', { class: 'dirty-dot' }))

    this.findButton.disabled = !file || file.state !== 'ready'
    this.moreButton.disabled = !file && !model.previewPath && !model.selectedPath
    this.findFileButton.disabled = !model.hasFolder
    this.recentButton.disabled = !model.hasFolder

    // Closing the file, or deleting it, leaves nothing to look at: back to the list.
    if (this.showingDetail && !file && !model.previewPath) {
      this.showingDetail = false
      this.applyLayout()
    }
    this.updateKeyboardBar()
  }

  command (name, payload) {
    this.bridge.sendCommand(name, payload)
  }

  /** The Mac's LoText and Help menus, and the two File items the sidebar's bar has no room for. */
  async appMenu () {
    const model = this.model
    const items = [
      { title: 'Settings…', run: () => this.openSettings() },
      { title: 'Help: Enhanced Tasks', run: () => this.command('helpTasks') },
      { title: 'Help: Disclosure Arrows', run: () => this.command('helpDisclosures') },
      { title: 'Help: Markdown Formatting', run: () => this.command('helpMarkdown') },
    ]
    if (model.hasFolder) {
      items.unshift(
        { title: 'New File', run: () => this.command('newFile') },
        { title: 'New Folder', run: () => this.command('newFolder') })
    }
    await this.run(items)
  }

  /** The Mac's File, Edit and Format menus, for the file on screen. */
  async fileMenu () {
    const model = this.model
    const file = model.openFile
    const ready = file?.state === 'ready'
    const items = []
    if (ready) {
      items.push(
        { title: 'Save', run: () => this.command('save') },
        { title: 'Print…', run: () => this.command('print') },
        { title: 'Share PDF…', run: () => this.sharePDF() },
        { title: 'Find and Replace…', run: () => this.command('findAndReplace') },
        { title: 'Bold', run: () => this.command('bold') },
        { title: 'Italic', run: () => this.command('italic') })
      // The one command here that needs a selection, and the phone has no right-click menu to
      // offer it from, so it is listed only while there is one.
      if (model.editor?.takeSelection()) {
        items.push({ title: 'Cut and Send to DayCap', run: () => this.command('cutAndSendToDayCap') })
      }
    }
    if (model.selectedPath && !FilePath.isRoot(model.selectedPath)) {
      items.push({ title: 'Duplicate', run: () => this.command('duplicate') })
    }
    if (file || model.previewPath) items.push({ title: 'Close File', run: () => this.command('closeFile') })
    await this.run(items)
  }

  async run (items, options) {
    if (!items.length) return
    const index = await chooseFrom(items, options)
    if (index >= 0) await items[index].run()
  }

  async sharePDF () {
    const model = this.model
    const file = model.openFile
    if (!file || file.state !== 'ready') return
    await model.saveIfDirty({ allowingPrompts: true })
    try {
      await this.bridge.sharePDF({ text: model.editor.text, fileName: file.fileName })
    } catch (error) {
      await model.alerts.error('The PDF could not be made.', error.message)
    }
  }

  // MARK: - Touch

  /** The sidebar's menus, as the system's action sheet pointing at where the finger was. */
  async presentMenu (event, items) {
    const usable = items.filter((item) => !item.separator)
    const at = event?.clientX != null ? { x: event.clientX, y: event.clientY } : lastPointer
    const index = await chooseFrom(
      usable.map((item) => ({ title: item.label, destructive: item.destructive })), { at })
    if (index >= 0) await usable[index].action()
  }

  /**
   * A finger resting on a row opens the row's menu — the Mac's right-click. A row that moved
   * under the finger was a scroll, and opens nothing.
   */
  watchTouches () {
    const list = this.sidebar.listNode
    let press = null
    let swallowClicksUntil = 0
    const cancel = () => { clearTimeout(press?.timer); press = null }

    list.addEventListener('touchstart', (event) => {
      cancel()
      if (event.touches.length !== 1) return
      const row = event.target.closest('.row')
      if (!row || row.querySelector('.rename-field')) return
      const touch = event.touches[0]
      press = {
        x: touch.clientX,
        y: touch.clientY,
        timer: setTimeout(() => {
          const node = this.model.tree.nodeAt(row.dataset.path)
          const at = press
          press = null
          if (!node) return
          swallowClicksUntil = Date.now() + 700
          this.sidebar.showRowMenu({
            clientX: at.x, clientY: at.y, preventDefault () {}, stopPropagation () {},
          }, node)
        }, LONG_PRESS),
      }
    }, { passive: true })
    list.addEventListener('touchmove', (event) => {
      const touch = event.touches[0]
      if (press && Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > 10) cancel()
    }, { passive: true })
    list.addEventListener('touchend', cancel, { passive: true })
    list.addEventListener('touchcancel', cancel, { passive: true })
    // The lift that ends a long press is not also a tap on the row.
    list.addEventListener('click', (event) => {
      if (Date.now() < swallowClicksUntil) { event.stopPropagation(); event.preventDefault() }
    }, true)
  }

  /**
   * Move To…, which is what dragging a row is on the Mac. Every folder under the opened one is
   * offered that the row can go to; the list is walked afresh, since the tree only knows the
   * folders that have been twirled open.
   */
  async moveTo (node) {
    const model = this.model
    const folders = [FilePath.ROOT]
    let frontier = [FilePath.ROOT]
    for (let depth = 0; depth < 12 && frontier.length && folders.length < 400; depth += 1) {
      const next = []
      for (const folder of frontier) {
        const children = await this.bridge.children(folder).catch(() => [])
        for (const child of children) {
          if (child.kind !== 'folder' || child.leavesTheFolder) continue
          folders.push(child.path)
          next.push(child.path)
        }
      }
      frontier = next
    }
    const destinations = folders.filter((folder) => model.canMove(node.path, folder))
    if (!destinations.length) {
      await model.alerts.error(`There is nowhere to move ${quote(node.name)}.`,
        'It is already in the only folder it could go to.')
      return
    }
    await this.run(destinations.map((folder) => ({
      title: FilePath.isRoot(folder) ? model.folder.name : `${model.folder.name} / ${FilePath.components(folder).join(' / ')}`,
      run: () => model.move(node.path, folder),
    })), { title: `Move ${quote(node.name)} to…`, at: null })
  }

  // MARK: - The keyboard bar

  buildKeyboardBar () {
    const bar = document.getElementById('keyboard-bar')
    const editor = () => this.model.editor
    const key = (name, title, action) => {
      const node = element('button', { class: 'key', title }, [icon(name, 21)])
      // Pressed on the way down, and the press is kept from taking the keyboard out of the text.
      node.addEventListener('pointerdown', (event) => { event.preventDefault(); action() })
      return node
    }
    bar.append(
      key('indent', 'Tab', () => editor().indent()),
      key('outdent', 'Shift-Tab', () => editor().outdent()),
      key('task', 'Task', () => editor().startTask()),
      key('bold', 'Bold', () => editor().toggleBold()),
      key('italic', 'Italic', () => editor().toggleItalic()),
      element('div', { class: 'spacer' }),
      key('undo', 'Undo', () => editor().undo()),
      key('redo', 'Redo', () => editor().redo()),
      key('keyboardDown', 'Hide Keyboard', () => editor().blur()))
    this.keyboardBar = bar

    Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {})
    Keyboard.addListener('keyboardWillShow', ({ keyboardHeight }) => {
      this.keyboardHeight = keyboardHeight
      this.updateKeyboardBar()
    })
    Keyboard.addListener('keyboardWillHide', () => {
      this.keyboardHeight = 0
      this.updateKeyboardBar()
    })
    document.addEventListener('focusin', (event) => {
      quietField(event.target)
      this.updateKeyboardBar()
    })
    document.addEventListener('focusout', () => setTimeout(() => this.updateKeyboardBar(), 0))
  }

  updateKeyboardBar () {
    const showing = this.keyboardHeight > SOFT_KEYBOARD && Boolean(this.model.editor?.isFocused) &&
      !this.model.sheet
    if (this.keyboardBar.hidden === !showing) return
    this.keyboardBar.hidden = !showing
    document.body.classList.toggle('keyboard-bar-showing', showing)
  }

  // MARK: - A hardware keyboard

  /**
   * The Mac's menu keys. On the Mac the menu bar catches them before the page does; here the
   * page is all there is, so they are caught on the way down, before the editor sees them.
   */
  watchKeys () {
    window.addEventListener('keydown', (event) => {
      if (!event.metaKey || event.ctrlKey) return
      const name = shortcut(event)
      if (!name) return
      const inEditor = Boolean(this.model.editor?.isFocused)
      // Undo and redo belong to whatever text has the keyboard; the editor's own history is
      // only reached from here because the menu claims the key from it on the Mac.
      if ((name === 'undo' || name === 'redo') && !inEditor) return
      event.preventDefault()
      event.stopPropagation()
      this.perform(name)
    }, true)
  }

  perform (name) {
    const model = this.model
    switch (name) {
      case 'undo': model.editor.undo(); break
      case 'redo': model.editor.redo(); break
      case 'bigger': this.bridge.stepFontSize(1); break
      case 'smaller': this.bridge.stepFontSize(-1); break
      case 'actualSize': this.bridge.resetFontSize(); break
      case 'settings': this.openSettings(); break
      default: this.command(name)
    }
  }

  // MARK: - Settings

  buildSettingsSheet () {
    this.settingsHost = document.getElementById('settings-host')
    // The panel's page asks its parent for a bridge. It gets the app's, except that what it
    // subscribes to is dropped when the sheet closes, so a closed panel is never redrawn.
    window.lotextForFrame = () => {
      const subscriptions = []
      const scoped = Object.create(this.bridge)
      for (const name of ['onSettingsChanged', 'onCloudStatus']) {
        scoped[name] = (listener) => {
          const off = this.bridge[name](listener)
          subscriptions.push(off)
          return off
        }
      }
      this.disposeFrame = () => { for (const off of subscriptions) off() }
      return scoped
    }
  }

  openSettings () {
    if (!this.settingsHost.hidden) return
    this.model.editor?.blur()
    this.settingsTitle = element('div', { class: 'bar-title' }, [element('span', { text: 'Settings' })])
    const done = element('button', { class: 'bar-button done', text: 'Done', onclick: () => this.closeSettings() })
    const frame = element('iframe', { class: 'settings-frame', src: 'settings.html', title: 'Settings' })
    clear(this.settingsHost)
    this.settingsHost.append(
      element('div', { class: 'mobile-bar settings-bar' }, [
        element('div', { class: 'bar-side leading' }),
        this.settingsTitle,
        element('div', { class: 'bar-side trailing' }, [done]),
      ]),
      frame)
    this.settingsHost.hidden = false
  }

  closeSettings () {
    this.disposeFrame?.()
    this.disposeFrame = null
    this.settingsHost.hidden = true
    clear(this.settingsHost)
  }

  // MARK: - Coming and going

  /**
   * Going to the background is the Mac's focus loss — one of the three times a file saves —
   * and coming back is the Mac's coming forward, which is also when a change nothing reported
   * gets noticed: there is no watcher on iOS.
   */
  watchLifecycle () {
    Native.addListener('appState', ({ active }) => {
      if (active === this.appActive) return
      this.appActive = active
      if (!active) {
        window.dispatchEvent(new Event('blur'))
        this.bridge.flushPreferences()
      } else {
        window.dispatchEvent(new Event('focus'))
        this.bridge.emit('folder:changed')
      }
    })
  }
}

/**
 * A name typed into a search or a rename is a file name, not a sentence: no capital letter
 * forced onto it, no word swapped for one the dictionary prefers, no suggestion bar.
 */
function quietField (node) {
  if (node?.tagName !== 'INPUT' && node?.tagName !== 'TEXTAREA') return
  node.setAttribute('autocorrect', 'off')
  node.setAttribute('autocapitalize', 'off')
  node.setAttribute('spellcheck', 'false')
  node.setAttribute('autocomplete', 'off')
}

/** Which of the Mac's menu commands a ⌘ key press is, by the key's position rather than its letter. */
function shortcut (event) {
  const shift = event.shiftKey
  const alt = event.altKey
  const code = event.code
  if (alt) {
    if (code === 'KeyF' && !shift) return 'findAndReplace'
    if (code === 'BracketLeft' && !shift) return 'hideLines'
    if (code === 'BracketRight' && !shift) return 'showLines'
    return null
  }
  const plain = {
    KeyS: 'save', KeyN: 'newFile', KeyO: 'openFolder', KeyP: 'print', KeyW: 'closeFile',
    KeyR: 'refresh', KeyB: 'bold', KeyI: 'italic', KeyD: 'selectNextInstance', KeyF: 'find',
    KeyG: 'findNext', KeyE: 'useSelectionForFind', KeyZ: 'undo', Equal: 'bigger',
    Minus: 'smaller', Digit0: 'actualSize', Comma: 'settings', Backspace: 'deleteImmediately',
  }
  const shifted = {
    KeyN: 'newFolder', KeyD: 'duplicate', KeyO: 'goToLastFile', KeyP: 'findFile',
    KeyB: 'toggleSidebar', KeyG: 'findPrevious', KeyZ: 'redo', Equal: 'bigger',
  }
  return (shift ? shifted : plain)[code] ?? null
}
