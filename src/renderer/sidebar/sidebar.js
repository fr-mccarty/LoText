// The file tree of the opened folder, under a row of four buttons and the folder's own name.
//
// An outline of unlimited depth, flattened to the rows that are actually visible so that
// collapsed folders are never read. A click anywhere along a folder row — triangle included —
// twirls it and never opens anything. A file nothing in the window can show is drawn dim and
// carries no action at all, so clicking it does nothing whatsoever and the highlight stays
// where it was.
//
// **The highlight is not set by clicking alone.** It is copied from whichever file is open —
// one source of truth — and rests on a folder only so that ⌫ has something to aim at. The open
// file's row also carries its unsaved-changes dot: with no tab bar, there is nowhere else left
// to put it.
//
// The strip at the top is *stacked above* the list rather than laid over it, so nothing can
// scroll behind the folder's name and there is one surface from the sidebar's edge to the split.

import * as FilePath from '../../shared/file-path.js'
import { openability } from '../../shared/binary-types.js'
import { element, clear, icon, quote } from '../dom.js'
import { showContextMenu } from '../context-menu.js'
import { scrollStep } from './drag-scroll.js'
import { keys, words, isWindows } from '../platform.js'

export class Sidebar {
  constructor (root, model) {
    this.root = root
    this.model = model
    this.listNode = null
    this.scrollTop = 0
    this.pendingScroll = null
    this.drag = null
    // The rename field outlives a redraw — see `renderRows`.
    this.renameField = null
    this.isRedrawing = false
    this.build()
  }

  build () {
    clear(this.root)
    this.bannerNode = element('div', { class: 'sidebar-banner' })
    this.actionsNode = this.buildActions()
    this.headerNode = element('div', { class: 'sidebar-header' })
    this.noteNode = element('div', { class: 'sidebar-note' })
    this.listNode = element('div', {
      class: 'sidebar-list',
      tabindex: '0',
      onscroll: () => { this.scrollTop = this.listNode.scrollTop },
      onkeydown: (event) => this.onKeyDown(event),
      oncontextmenu: (event) => this.onEmptySpaceMenu(event),
    })
    // The empty space under the last row is the top level, as the folder's name is.
    this.listNode.dataset.dropPath = FilePath.ROOT
    this.root.append(
      element('div', { class: 'sidebar-top' }, [this.bannerNode, this.actionsNode, this.headerNode, this.noteNode]),
      this.listNode)
  }

  /**
   * Open-folder, new-file, new-folder — and **Refresh at the right-hand end**, on ⌘R's own
   * call: a folder on this machine has a watcher and will rarely need it, and a folder on a
   * server has nothing watching it at all, so there the button is the whole of how the tree
   * learns that someone else added a file.
   */
  buildActions () {
    const button = (name, title, onClick, needsFolder) => {
      const node = element('button', {
        class: 'icon-button',
        title,
        onclick: onClick,
      }, [icon(name, 15)])
      node.dataset.needsFolder = needsFolder ? 'yes' : 'no'
      return node
    }
    return element('div', { class: 'sidebar-actions' }, [
      button('folder', keys('Open Folder (⌘O)'), () => this.model.openFolder(), false),
      button('newFile', keys('New File (⌘N)'), () => this.model.newFile(null), true),
      button('newFolder', keys('New Folder (⇧⌘N)'), () => this.model.newFolder(null), true),
      element('div', { class: 'spacer' }),
      button('refresh', keys('Refresh (⌘R)'), () => this.model.refreshFolder(), true),
    ])
  }

  // MARK: - Drawing

  render () {
    const model = this.model
    for (const node of this.actionsNode.querySelectorAll('button[data-needs-folder="yes"]')) {
      node.disabled = !model.hasFolder
    }

    clear(this.bannerNode)
    if (model.folderIsUnavailable) {
      this.bannerNode.append(element('div', { class: 'banner' },
        [icon('warning', 13), element('span', { text: 'Folder unavailable' })]))
    }

    clear(this.headerNode)
    if (model.folder) this.headerNode.append(this.buildRootHeader(model.folder))

    clear(this.noteNode)

    this.renderRows()
  }

  /**
   * The opened folder's name, at the head of its own tree, doing the three jobs that fall to
   * the one place meaning *the top level*: it says which folder this is, it takes a drop, and a
   * click makes a file or a folder there. A folder that is not on this Mac's own disk says so
   * with a small tag after its name: SSH for one on a server, MNT for one on a mounted volume.
   */
  buildRootHeader (folder) {
    const name = folder.name
    const tag = folderTag(folder)
    const node = element('div', {
      class: 'sidebar-root',
      title: `${quote(name)} is the opened folder. Click it to add a file or folder at the top level.`,
      onclick: (event) => this.showNewItemMenu(event, FilePath.ROOT),
      oncontextmenu: (event) => this.showNewItemMenu(event, FilePath.ROOT),
    }, [
      element('span', { text: name }),
      tag && element('span', { class: 'folder-tag', ...tag }),
    ])
    node.dataset.dropPath = FilePath.ROOT
    return node
  }

  renderRows () {
    const model = this.model
    const rows = model.tree.visibleRows()
    if (this.renameField?.path !== model.tree.renamingPath) this.renameField = null
    // A redraw can land mid-rename — making a folder wakes the watcher, which redraws the tree
    // just after the field took the keyboard. Removing a focused field blurs it, and blur
    // commits: the name would be settled before a key was typed. So the blur is ignored here,
    // the same field goes back into the new row, and it gets the keyboard back with its text
    // and selection as they were.
    const hadKeyboard = this.renameField && document.activeElement === this.renameField.node
    this.isRedrawing = true
    clear(this.listNode)
    for (const row of rows) this.listNode.append(this.buildRow(row))
    this.isRedrawing = false
    if (hadKeyboard && this.renameField?.node.isConnected) this.renameField.node.focus()
    this.listNode.scrollTop = this.scrollTop
    if (this.pendingScroll) {
      const target = this.listNode.querySelector(`[data-path="${cssEscape(this.pendingScroll)}"]`)
      this.pendingScroll = null
      target?.scrollIntoView({ block: 'center' })
    }
  }

  buildRow ({ node, depth }) {
    const model = this.model
    const isFolder = node.kind === 'folder'
    const kind = openability(FilePath.name(node.path), isFolder)
    // Folders are never dimmed, whatever they contain. A previewable file is not dimmed either:
    // the editor cannot take it, but a viewer can show it, so it is an ordinary row.
    const isDimmed = !isFolder && kind === 'opaque'
    const isSelected = model.selectedPath === node.path
    const openHere = model.openFile?.path === node.path ? model.openFile : null
    const isExpanded = model.tree.expanded.has(node.path)
    const isRenaming = model.tree.renamingPath === node.path

    const row = element('div', {
      class: `row${isSelected ? ' selected' : ''}${isDimmed ? ' dimmed' : ''}`,
      dataset: { path: node.path },
      style: { paddingLeft: `${8 + depth * 13}px` },
    })

    const disclosure = element('span', { class: `disclosure${isExpanded ? ' open' : ''}` },
      isFolder ? [icon('chevron', 11)] : [])
    row.append(disclosure)
    row.append(element('span', { class: 'row-icon' }, [
      icon(isFolder ? 'folder' : 'doc', 14),
      // A link twirls open where it sits like any other folder, so the badge is not a warning
      // about what clicking will do; it is the one thing on the row saying that what is inside
      // lives somewhere else.
      node.isLink ? element('span', { class: 'link-badge' }, [icon('link', 8)]) : null,
    ]))

    if (isRenaming) {
      row.append(this.buildRenameField(node))
    } else {
      row.append(element('span', { class: 'row-name', text: node.name }))
      row.append(element('span', { class: 'spacer' }))
      if (openHere?.needsAttention) {
        row.append(element('span', { class: 'attention', title: 'This file needs attention' },
          [icon('warning', 11)]))
      } else if (openHere?.isDirty) {
        row.append(element('span', { class: 'dirty-dot', title: 'Unsaved changes' }))
      }
    }

    if (!isDimmed && !isRenaming) {
      row.addEventListener('click', () => this.activate(node))
    }
    row.addEventListener('contextmenu', (event) => this.showRowMenu(event, node))

    // Dragging is the only way to rearrange, and re-parenting is all of it: the tree sorts
    // folders first and then by name, so a row has no position of its own to be dragged to.
    if (!isRenaming) row.addEventListener('mousedown', (event) => this.beginPress(event, node))
    // A file row hands a drop to the folder it is in, so there is no dead space between rows.
    row.dataset.dropPath = isFolder ? node.path : (FilePath.parent(node.path) ?? FilePath.ROOT)

    return row
  }

  buildRenameField (node) {
    if (this.renameField?.path === node.path) return this.renameField.node
    const { stem } = splitForEditing(node.name)
    const field = element('input', {
      class: 'rename-field',
      type: 'text',
      value: node.name,
      spellcheck: 'false',
    })
    field.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') { event.preventDefault(); this.model.commitRename(node.path, field.value) }
      if (event.key === 'Escape') {
        event.preventDefault()
        this.model.tree.cancelRename()
        this.model.commitRename(node.path, node.name)
      }
    })
    field.addEventListener('blur', () => {
      if (this.isRedrawing) return
      if (this.model.tree.renamingPath === node.path) {
        this.model.commitRename(node.path, field.value)
      }
    })
    // The base name is selected and the extension is left out of it, so typing a name and
    // hitting return names the file without destroying the extension.
    requestAnimationFrame(() => {
      field.focus()
      field.setSelectionRange(0, stem.length)
    })
    this.renameField = { path: node.path, node: field }
    return field
  }

  // MARK: - Interaction

  /**
   * A folder twirls; a file opens in the editor; a file only a viewer can take opens there
   * instead. Selecting a folder moves the highlight and opens nothing.
   *
   * A click leaves the keyboard in the sidebar, so the row stays blue and ⌘⌫ deletes it;
   * Enter is "open it and start typing", and hands the keyboard to the editor.
   */
  async activate (node, { focusEditor = false } = {}) {
    this.model.selectedPath = node.path
    if (!focusEditor) this.listNode.focus()
    if (node.kind === 'folder') {
      await this.model.tree.toggle(node.path)
    } else {
      await this.model.openPath(node.path, { focusEditor })
    }
    this.model.notify('tree')
  }

  /**
   * Plain ⌫, and only while the sidebar holds the keyboard. It is not a menu item and must
   * never become one: a menu shortcut fires wherever the focus is, and ⌫ in the menu would
   * swallow every backspace typed into the editor.
   */
  onKeyDown (event) {
    const rows = this.model.tree.visibleRows()
    const index = rows.findIndex((row) => row.node.path === this.model.selectedPath)

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      this.model.deleteSelected({ confirming: !(isWindows() ? event.ctrlKey : event.metaKey) })
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      const next = rows[Math.min(Math.max(0, index + step), rows.length - 1)]
      if (next) { this.model.selectedPath = next.node.path; this.model.notify('tree') }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const row = rows[index]
      if (row) this.activate(row.node, { focusEditor: true })
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const row = rows[index]
      if (row?.node.kind !== 'folder') return
      event.preventDefault()
      if (event.key === 'ArrowRight') this.model.tree.expand(row.node.path)
      else this.model.tree.collapse(row.node.path)
    }
  }

  // MARK: - Dragging

  /**
   * A row is dragged with the mouse events themselves rather than HTML5 drag and drop. The
   * native drag session is what failed here — nothing ever arrived at the drop — and a move
   * inside one list needs none of what it offers: no pasteboard, no other application.
   * A press becomes a drag only once it has travelled a few pixels, so a click is still a click.
   */
  beginPress (event, node) {
    if (event.button !== 0 || event.ctrlKey) return
    const drag = { path: node.path, name: node.name, x: event.clientX, y: event.clientY, ghost: null, target: null }
    const onMove = (move) => {
      if (!drag.ghost) {
        if (Math.hypot(move.clientX - drag.x, move.clientY - drag.y) < 4) return
        drag.ghost = element('div', { class: 'drag-ghost' }, [
          icon(node.kind === 'folder' ? 'folder' : 'doc', 13),
          element('span', { text: node.name }),
        ])
        document.body.append(drag.ghost)
        document.body.classList.add('row-dragging')
        this.drag = drag
      }
      drag.ghost.style.transform = `translate(${move.clientX + 10}px, ${move.clientY + 6}px)`
      drag.pointer = { x: move.clientX, y: move.clientY }
      this.markDropTarget(this.dropTargetAt(move.clientX, move.clientY))
      this.scrollWhileNearEdge(drag)
    }
    const finish = (up) => {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('mouseup', finish, true)
      document.removeEventListener('keydown', onKey, true)
      if (!drag.ghost) return
      const target = up ? this.dropTargetAt(up.clientX, up.clientY) : null
      this.endDrag()
      // The mouse-up of a drag is not a click on whatever row it ended over.
      const swallow = (click) => { click.stopPropagation(); click.preventDefault() }
      document.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => document.removeEventListener('click', swallow, true), 0)
      if (target) this.model.move(drag.path, target.dataset.dropPath)
    }
    const onKey = (key) => {
      if (key.key !== 'Escape') return
      key.preventDefault()
      key.stopPropagation()
      finish(null)
    }
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('mouseup', finish, true)
    document.addEventListener('keydown', onKey, true)
  }

  /**
   * Near the list's top or bottom edge, or past it, the list scrolls a little every frame until
   * the pointer leaves the edge or the drag ends. The rows move under a pointer that is standing
   * still, so the drop target is read again after every step.
   */
  scrollWhileNearEdge (drag) {
    if (drag.scrolling) return
    const step = () => {
      if (this.drag !== drag) { drag.scrolling = null; return }
      const list = this.listNode.getBoundingClientRect()
      const amount = scrollStep(drag.pointer.y, list.top, list.bottom)
      const before = this.listNode.scrollTop
      if (amount) this.listNode.scrollTop = before + amount
      if (this.listNode.scrollTop === before) { drag.scrolling = null; return }
      this.markDropTarget(this.dropTargetAt(drag.pointer.x, drag.pointer.y))
      drag.scrolling = requestAnimationFrame(step)
    }
    drag.scrolling = requestAnimationFrame(step)
  }

  /** The element that would take a drop at this point, or null where nothing can. */
  dropTargetAt (x, y) {
    const target = document.elementFromPoint(x, y)?.closest('[data-drop-path]')
    if (!target || !this.root.contains(target)) return null
    return this.model.canMove(this.drag?.path, target.dataset.dropPath) ? target : null
  }

  markDropTarget (target) {
    if (this.drag.target === target) return
    this.drag.target?.classList.remove('drop-target')
    target?.classList.add('drop-target')
    this.drag.target = target
  }

  endDrag () {
    if (this.drag?.scrolling) cancelAnimationFrame(this.drag.scrolling)
    this.drag?.target?.classList.remove('drop-target')
    this.drag?.ghost?.remove()
    document.body.classList.remove('row-dragging')
    this.drag = null
  }

  // MARK: - Menus

  /**
   * The sidebar's right-click menu, offered on every row — a dimmed file can still be renamed
   * and deleted, since only opening is restricted.
   */
  showRowMenu (event, node) {
    event.preventDefault()
    event.stopPropagation()
    this.model.selectedPath = node.path
    this.model.notify('tree')
    // Right-clicking a folder creates inside it; right-clicking a file creates beside it.
    const target = node.kind === 'folder' ? node.path : (FilePath.parent(node.path) ?? FilePath.ROOT)
    const items = [
      { label: 'New File', action: () => this.createIn('file', target) },
      { label: 'New Folder', action: () => this.createIn('folder', target) },
      { separator: true },
    ]
    // Nothing to show in Finder, and no path on this machine to copy, when the file is on
    // another machine or in the iOS app's container. An item that silently did nothing would be
    // worse than one that is not there.
    if (this.model.folder?.capabilities?.localPath) {
      items.push({
        label: `Open in ${words.fileManager}`,
        action: () => this.model.bridge.reveal(node.path, node.kind === 'folder'),
      })
      items.push({
        label: 'Copy Absolute Path',
        action: () => this.model.bridge.copyAbsolutePath(node.path),
      })
    }
    if (node.isLink && node.leavesTheFolder && node.kind === 'folder') {
      // Going *to* the far end is the rarer of the two wants, so it is asked for rather than
      // assumed: the link twirls open in place like every other folder.
      items.push({ label: 'Open as Folder', action: () => this.openAsFolder(node.path) })
    }
    items.push({ separator: true })
    items.push(...this.extraRowItems(node))
    items.push({ label: 'Duplicate', action: () => this.model.duplicate(node.path) })
    items.push({ label: 'Rename', action: () => this.model.tree.beginRename(node.path) })
    items.push({ label: 'Delete', destructive: true, action: () => this.model.requestDelete(node.path) })
    this.presentMenu(event, items)
  }

  /**
   * Where a menu is drawn. The Mac draws its own, under the pointer; iOS replaces this with the
   * system's action sheet (src/mobile/ui.js).
   */
  presentMenu (event, items) {
    showContextMenu(event, items)
  }

  /** Items a platform adds to every row's menu — on iOS, Move To…, for a finger that cannot drag. */
  extraRowItems () {
    return []
  }

  /** The empty space under the tree means the top level too, which the row menus cannot say. */
  onEmptySpaceMenu (event) {
    if (event.target.closest('.row')) return
    event.preventDefault()
    if (!this.model.hasFolder) return
    this.presentMenu(event, [
      { label: 'New File', action: () => this.createIn('file', FilePath.ROOT) },
      { label: 'New Folder', action: () => this.createIn('folder', FilePath.ROOT) },
    ])
  }

  showNewItemMenu (event, target) {
    event.preventDefault()
    event.stopPropagation()
    this.presentMenu(event, [
      { label: 'New File', action: () => this.createIn('file', target) },
      { label: 'New Folder', action: () => this.createIn('folder', target) },
    ])
  }

  async createIn (kind, target) {
    // Twirl the folder open first, so whatever is created lands somewhere visible.
    if (!FilePath.isRoot(target)) await this.model.tree.expand(target)
    if (kind === 'file') await this.model.newFile(target)
    else await this.model.newFolder(target)
  }

  /**
   * Going *to* the far end — making it the window's own folder, the way Open Folder… would.
   * Offered on links only, and asked for rather than assumed.
   */
  async openAsFolder (path) {
    const node = this.model.tree.nodeAt(path)
    if (!node) return
    const choice = await this.model.alerts.present({
      type: 'question',
      title: `Open ${quote(node.name)} as this window's folder?`,
      message: 'The window will show what the link points at, instead of the folder it is in.',
      buttons: [{ title: 'Open' }, { title: 'Cancel', cancel: true }],
    })
    if (choice !== 0) return
    await this.model.adopting(() => this.model.bridge.openLinkAsFolder(path))
  }

  reveal (path) {
    this.pendingScroll = path
  }
}

/** `notes.md` → base name `notes`, so the extension stays out of the initial selection. */
function splitForEditing (name) {
  const body = name.startsWith('.') ? name.slice(1) : name
  const dot = body.lastIndexOf('.')
  if (dot <= 0) return { stem: name, extension: '' }
  const offset = name.length - body.length
  return { stem: name.slice(0, offset + dot), extension: name.slice(offset + dot) }
}

function cssEscape (value) {
  return String(value).replace(/["\\]/g, '\\$&')
}

/**
 * The one tag after the folder's name, or null: SSH for a folder on a server, otherwise MNT for
 * one on a mounted volume. A folder gets one tag at most, and a server folder is never MNT.
 */
export function folderTag (folder) {
  if (folder?.kind === 'remote') return { text: 'SSH', title: 'This folder is on a server, reached over SSH.' }
  if (folder?.isMounted) return { text: 'MNT', title: 'This folder is on a mounted volume, such as a network share or an external drive.' }
  return null
}
