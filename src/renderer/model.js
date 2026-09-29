// The window's model: one folder, one open file, and every rule about how the two meet.
//
// Who talks to whom:
//
//                        the window
//                             │
//       ┌──────────┬──────────┼─────────┬────────┐
//   OPEN FILE  FILE TREE  FIND FILE  VIEWERS  WATCHER
//       └──────────┴──────────┼─────────┴────────┘
//                             │
//                        FILE STORE  ← the only door to the file system
//
// The editor reads view settings; the printer reads print settings; neither ever reads the
// other's. Markdown is *understood* in the printer and nowhere else. The sidebar highlight
// follows the open file and is never set independently.

import * as FilePath from '../shared/file-path.js'
import { stampsMatch } from '../shared/file-stamp.js'
import { openability, viewerFor, isBinary, isPreviewable } from '../shared/binary-types.js'
import { FileTree } from './tree.js'
import { OpenFile } from './open-file.js'
import { Alerts } from './alerts.js'
import { quote } from './dom.js'

export class AppModel {
  constructor (bridge) {
    this.bridge = bridge
    this.alerts = new Alerts(bridge)
    this.tree = new FileTree(bridge, { onChange: () => this.notify('tree') })

    this.folder = null                        // { key, name, kind, capabilities }
    this.folderIsUnavailable = false
    this.openFile = null
    this.previewPath = null
    this.previewState = null
    this.selectedPath = null
    this.settings = null
    this.sidebarVisible = true
    this.isEditingText = false
    /** The window is closing, and the user chose to stay rather than let a failed save go. */
    this.isClosing = false
    this.leaveRefused = false

    /** ⇧⌘O's list: the files changed most recently on disk, newest first; null while reading. */
    this.recentFiles = null
    this.recentToken = 0
    this.recentHighlight = 0

    this.sheet = null                         // 'findFile' | 'recentFiles' | 'connect'
    this.listeners = new Set()
    this.editor = null
  }

  // MARK: - Cut and Send to DayCap

  /**
   * The selection saved as a new `.md` file in the DayCap folder, then cut: taken out of the
   * text and put on the clipboard, as one edit ⌘Z puts back. Saved first, so a failure leaves
   * the text where it was.
   */
  async cutAndSendToDayCap () {
    const taken = this.editor?.takeSelection()
    if (!taken) return
    let name
    try {
      name = await this.bridge.sendToDayCap(taken.text)
    } catch (error) {
      await this.alerts.error('The text was not sent to DayCap.', error.message)
      return
    }
    if (name === null) return
    await this.bridge.copyToClipboard(taken.text).catch(() => {})
    this.editor.removeTaken(taken)
  }

  // MARK: - Observing

  subscribe (listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  notify (what = 'all') {
    for (const listener of this.listeners) listener(what)
    this.reportMenuState()
    this.updateTitle()
  }

  get hasFolder () { return this.folder !== null }
  get hasOpenFile () { return this.openFile !== null }
  get hasUnsavedChanges () { return Boolean(this.openFile?.isDirty) }
  get isRemoteFolder () { return this.folder?.kind === 'remote' }
  get isForeground () { return document.hasFocus() }

  /** The window's title is the current file's name, and the modified mark rides with it. */
  updateTitle () {
    const name = this.openFile?.fileName ??
      (this.previewPath ? FilePath.name(this.previewPath) : null) ??
      this.folder?.name ?? 'LoText'
    this.bridge.setTitle(name, this.hasUnsavedChanges).catch(() => {})
  }

  reportMenuState () {
    this.bridge.reportMenuState({
      hasFolder: this.hasFolder,
      hasOpenFile: this.hasOpenFile,
      canDuplicate: Boolean(this.selectedPath) && !FilePath.isRoot(this.selectedPath ?? ''),
      canPrint: this.hasOpenFile && this.openFile.state === 'ready',
      isEditingText: this.isEditingText,
    })
  }

  // MARK: - Launch

  async start () {
    this.settings = await this.bridge.readSettings()
    this.bridge.onSettingsChanged((state) => {
      this.settings = state
      this.notify('settings')
    })
    this.bridge.onFolderChanged(() => this.folderDidChange())
    this.bridge.onMenuCommand(({ command, payload }) => this.runCommand(command, payload))
    this.bridge.onOpenFile((file) => this.openFromOutside(file))
    this.bridge.onSettle(() => this.settleAndClose())

    // Focus loss is one of the three save occasions. The other two are ⌘S and leaving the file.
    window.addEventListener('blur', () => {
      this.notePosition()
      this.saveIfDirty({ allowingPrompts: false })
    })
    window.addEventListener('focus', () => this.appBecameActive())

    await this.restoreSession()
    this.bridge.ready()
    this.notify()
  }

  /**
   * A quit with two folders open in two windows relaunches with two, each with its folder and
   * its open file. A remembered file that no longer exists is dropped quietly — there is no
   * unsaved text to protect, so an alert at launch would be noise.
   */
  async restoreSession () {
    const record = await this.bridge.restoreRecord()
    if (!record?.folder) return
    try {
      if (record.folder.kind === 'remote') {
        this.folder = await this.bridge.connectToServer(addressOf(record.folder.location))
      } else {
        // A window restoring its session reads the queue before reopening the file it
        // remembers: if something is on its way in that this folder holds, both want the one
        // editor and only one of them was just double-clicked.
        const claimed = await this.bridge.queueClaims(record.folder.path)
        this.folder = await this.bridge.adoptFolder(record.folder.path)
        if (claimed) { await this.afterAdopting(); return }
      }
    } catch (error) {
      await this.alerts.error(
        `${quote(record.folder.name ?? 'That folder')} could not be reopened.`,
        `${error.message} Choose it again to carry on.`)
      return
    }
    await this.afterAdopting()
    if (record.openFile && await this.bridge.exists(record.openFile)) {
      await this.open(record.openFile)
    }
  }

  // MARK: - The folder

  async openFolder () {
    await this.adopting(() => this.bridge.openFolder())
  }

  async openRecent (id) {
    await this.adopting(() => this.bridge.openRecentFolder(id), async (error) => {
      // An entry whose folder no longer resolves **is kept**, and the alert offers to try
      // again. A disk asleep for the weekend and a folder that has been deleted are the same
      // answer from here, and guessing wrong would empty the menu of folders that were merely
      // offline.
      const choice = await this.alerts.present({
        title: 'That folder could not be opened.',
        message: `${error.message} It may have moved, or the volume may be offline.`,
        buttons: [
          { title: 'Try Again' },
          { title: 'Remove from Menu' },
          { title: 'Cancel', cancel: true },
        ],
      })
      if (choice === 0) await this.openRecent(id)
      else if (choice === 1) await this.bridge.forgetRecentFolder(id)
    })
  }

  async connectToServer (address) {
    await this.adopting(() => this.bridge.connectToServer(address), async (error) => {
      await this.alerts.error('That server could not be opened.', error.message)
      throw error
    })
  }

  /**
   * Every way a window gets a folder comes through here: unsaved text is settled first, the
   * tree is rebuilt, and no second window is made. A save that cannot go through cancels the
   * whole thing — the alert explaining why is already on screen.
   */
  async adopting (acquire, onError) {
    if (!await this.closeOpenFile()) return
    let described
    try {
      described = await acquire()
    } catch (error) {
      if (onError) await onError(error)
      else await this.alerts.error('That folder could not be opened.', error.message)
      return
    }
    if (!described) return
    this.folder = described
    this.previewPath = null
    this.previewState = null
    this.selectedPath = null
    await this.afterAdopting()
    this.bridge.rebuildMenu()
  }

  async afterAdopting () {
    this.folderIsUnavailable = Boolean(this.folder?.isUnavailable)
    this.tree.reset(this.folder?.expansion ?? [])
    await this.tree.load(FilePath.ROOT)
    // Restoring a remembered expansion never asks for anything: a folder whose contents cannot
    // be read silently twirls shut rather than sitting open and empty, which would say the
    // folder is empty when what is true is that it cannot be read.
    for (const path of [...this.tree.expanded]) await this.tree.ensureLoaded(path)
    this.notify()
  }

  async refreshFolder () {
    if (!this.hasFolder) return
    this.folderIsUnavailable = await this.bridge.refreshAvailability().catch(() => true)
    await this.tree.refresh()
    await this.rereadOpenFile()
    this.notify()
  }

  /**
   * ⌘R reads the open file again rather than trusting its stamp: a change on a server can keep
   * the size and land in the same second, and a mounted share can hand back cached attributes.
   * A buffer with unsaved edits still goes through the stamp check, so ⌘R never discards text.
   */
  async rereadOpenFile () {
    const file = this.openFile
    if (!file || file.isDirty || file.isSaving || file.state !== 'ready') {
      await this.reconcileOpenFile()
      return
    }
    try {
      const { text, lineEnding, stamp } = await this.bridge.readText(file.path)
      if (file !== this.openFile || file.isDirty) return    // switched away or typed meanwhile
      file.lastStamp = stamp
      if (text === this.editor.text && lineEnding === file.lineEnding) return
      file.lineEnding = lineEnding
      this.editor.reload(text)
      this.bridge.discardRecovery(file.path).catch(() => {})
    } catch {
      await this.reconcileOpenFile()                        // gone or unreadable: mark it as usual
    }
  }

  /** The watcher fired. It says that *something* changed and never what. */
  async folderDidChange () {
    if (!this.hasFolder) return
    await this.tree.refresh()
    await this.reconcileOpenFile()
    this.notify('tree')
  }

  async appBecameActive () {
    if (!this.hasFolder) return
    this.folderIsUnavailable = await this.bridge.refreshAvailability().catch(() => true)
    const file = this.openFile
    // A file gone from disk is *not* asked about here: dismissing an alert focuses the window
    // again, so asking on focus asked forever. Its question waits for ⌘S or leaving the file.
    if (file?.needsAttention && file.conflictStamp) {
      file.needsAttention = false
      await this.presentConflict(file)
    }
    // Coming forward is also where a change nothing reported gets noticed: a server folder has
    // no watcher, and FSEvents on a mounted share hears only this Mac's writes, not the server's.
    await this.reconcileOpenFile()
    this.notify()
  }

  // MARK: - Opening a file

  /**
   * Clicking the file that is *already* open does nothing at all beyond returning the keyboard
   * to the editor — in particular it must not re-read the file, which would throw away unsaved
   * text.
   *
   * `focusEditor: false` is a click in the sidebar: the keyboard stays there, so the row keeps
   * its blue and ⌫ / ⌘⌫ still aim at it. (A departure from Lolext, asked for.)
   */
  async open (path, { focusEditor = true } = {}) {
    if (this.openFile?.path === path) {
      if (focusEditor) this.editor?.focus()
      return true
    }
    if (!await this.closeOpenFile()) return false

    const file = this.makeOpenFile(path)
    this.notify()
    try {
      const [{ text, lineEnding, stamp }, position] = await Promise.all([
        this.bridge.readText(path),
        this.bridge.readPosition(path).catch(() => null),
      ])
      file.lineEnding = lineEnding
      file.lastStamp = stamp
      file.state = 'ready'
      this.editor.load(text)
      this.editor.apply(this.settings.view)
      if (focusEditor) this.editor.focus()
      await this.offerRecovery(file, text)
      // Where it was left, here or on another device (src/shared/sync/cloud-sync.js).
      if (this.openFile === file) this.editor.restorePosition(position)
    } catch (error) {
      file.state = 'failed'
      file.failure = error.message
    }
    this.notify()
    return true
  }

  /** A file this app just made: already empty, already known to be text, nothing to read. */
  async openFreshFile (path) {
    const file = this.makeOpenFile(path)
    file.state = 'ready'
    file.lineEnding = 'lf'
    this.editor.load('')
    this.editor.apply(this.settings.view)
    file.isDirty = false
    file.lastStamp = await this.bridge.stamp(path).catch(() => null)
    this.notify()
  }

  /**
   * One of the two funnels every file passes through on its way to the pane — the other is
   * `openPreviewable` — for the sidebar, ⌘N, ⇧⌘P, ⇧⌘O, the system and session restore alike.
   */
  makeOpenFile (path) {
    const file = new OpenFile(path)
    this.openFile = file
    this.previewPath = null
    this.previewState = null
    this.selectedPath = path
    this.bridge.noteOpenFile(path).catch(() => {})
    this.tree.expandChain(path)
    return file
  }

  /** A type the editor refuses but something can show: read-only, in the detail pane. */
  async openPreviewable (path) {
    if (!await this.closeOpenFile()) return
    this.previewPath = path
    this.previewState = { status: 'loading' }
    this.selectedPath = path
    // A previewed file is not remembered across a relaunch: there is no buffer behind it and
    // nothing unsaved, so a window that comes back with nothing on screen has lost nothing.
    this.bridge.noteOpenFile(null).catch(() => {})
    this.notify()

    const viewer = viewerFor(FilePath.name(path))
    try {
      this.previewState = { status: 'ready', viewer, payload: await this.bridge.loadForViewer(path, viewer) }
    } catch (error) {
      this.previewState = { status: 'failed', message: error.message }
    }
    this.notify()
  }

  /** The one rule, two callers: the sidebar and everything that opens a path. */
  async openPath (path, options) {
    const kind = openability(FilePath.name(path), false)
    if (kind === 'text') return this.open(path, options)
    if (kind === 'previewable') return this.openPreviewable(path)
    return false                              // an opaque row does nothing at all
  }

  async openFromOutside (absolutePath) {
    // The window is re-rooted at the folder around the file, because everything below the store
    // speaks in paths relative to a root — and the file itself cannot be one.
    const folder = absolutePath.replace(/\/[^/]*$/, '')
    const name = absolutePath.slice(folder.length + 1)
    if (this.folder?.kind === 'local' && await this.bridge.exists(name).catch(() => false)) {
      await this.openPath(name)
      return
    }
    await this.adopting(() => this.bridge.adoptFolder(folder))
    await this.openPath(name)
  }

  // MARK: - Closing

  /**
   * **Closing saves, and a save that cannot go through cancels the close.** Leaving a file is
   * the commonest route to the conflict prompt, so "switch anyway" would mean discarding
   * exactly the edits that prompt exists to protect.
   */
  async closeOpenFile () {
    const file = this.openFile
    if (!file) { this.previewPath = null; this.previewState = null; return true }
    this.notePosition()
    await this.save(file, { allowingPrompts: true, leaving: true })
    if (file.isDirty) return false            // the alert explaining why is already on screen
    file.cancelRecovery()
    this.openFile = null
    this.bridge.noteOpenFile(null).catch(() => {})
    return true
  }

  /** ⌘W closes the open file and returns the empty state with the window still open. */
  async closeFileCommand () {
    if (await this.closeOpenFile()) this.notify()
  }

  /** The window is going away: settle the buffer, then let it. */
  async settleAndClose () {
    this.notePosition()
    this.isClosing = true
    this.leaveRefused = false
    await this.saveIfDirty({ allowingPrompts: true, leaving: true })
    this.isClosing = false
    if (this.leaveRefused) this.bridge.cancelClose().catch(() => {})
    else this.bridge.windowSettled().catch(() => {})
  }

  /**
   * Where the open file was left — the caret, the selection and the top line — so reopening it
   * lands there. Noted on the way out of it, and whenever the window loses focus, which on iOS
   * is the app going to the background.
   */
  notePosition () {
    const file = this.openFile
    if (!file || file.state !== 'ready' || !this.editor) return
    this.bridge.savePosition(file.path, this.editor.position()).catch(() => {})
  }

  // MARK: - Saving

  /**
   * A file saves on three occasions and no others: ⌘S, losing focus, and leaving the file.
   * There is no idle or timer autosave. An untouched file is never written.
   */
  async saveIfDirty ({ allowingPrompts, leaving = false }) {
    const file = this.openFile
    if (!file) return true
    await this.save(file, { allowingPrompts, leaving })
    // A save that could not go through is exactly when the working copy matters, and waiting
    // out the debounce is exactly when there may be no more time.
    if (file.isDirty) await this.writeRecovery(file)
    return !file.isDirty
  }

  /**
   * **The one save path.** Every byte this app writes to a file leaves from here, and it always
   * hands the store the stamp recorded at the last read or write, so the store re-checks it
   * immediately before writing and refuses rather than overwriting a file that moved underneath
   * us. There is no second write path.
   *
   * "Saved" means written to this machine. Syncing is somebody else's job and may be minutes
   * away. A save never waits on the network and never fails for being offline.
   */
  async save (file, { allowingPrompts, leaving = false }) {
    if (!file.isDirty || file.isSaving) return   // clean buffers are never written
    if (file.state === 'loading' || file.state === 'failed') return
    if (file.state === 'missingOnDisk') {
      await this.requestRelocation(file, { allowingPrompts })
      return
    }

    file.isSaving = true
    try {
      const stamp = await this.bridge.writeText(
        file.path, this.editor.text, file.lineEnding, file.lastStamp)
      // Recording the stamp the write returned is what keeps our own writes from looking like
      // an external change to the watcher.
      file.lastStamp = stamp
      file.isDirty = false
      file.needsAttention = false
      file.conflictPending = false
      file.conflictStamp = null
      file.cancelRecovery()
      // The file on disk now says what the buffer says, so the working copy has nothing left
      // to protect.
      this.bridge.discardRecovery(file.path).catch(() => {})
    } catch (error) {
      // The copy first, before any alert: a failed save is exactly when the working copy
      // matters, and the alert can sit on screen until the app is quit out from under it.
      await this.writeRecovery(file)
      await this.saveFailed(file, error, { allowingPrompts, leaving })
    } finally {
      file.isSaving = false
      this.notify()
    }
  }

  async saveFailed (file, error, { allowingPrompts, leaving }) {
    switch (error.code) {
      case 'conflict':
        await this.noteConflict(file, error.current, { allowingPrompts })
        break
      case 'notFound':
        file.state = 'missingOnDisk'
        await this.requestRelocation(file, { allowingPrompts })
        break
      case 'folderUnavailable':
        this.folderIsUnavailable = true
        if (allowingPrompts && leaving) {
          await this.offerSaveAs(file, 'The folder is unavailable.',
            `${quote(file.fileName)} could not be saved there. Save the text somewhere else, or keep editing and try again once the folder is back.`)
        } else if (allowingPrompts) {
          await this.alerts.error('The folder is unavailable.',
            `${quote(file.fileName)} could not be saved. Your text is still here; reconnect the folder and save again.`)
        } else {
          file.needsAttention = true
        }
        break
      default:
        // A failed save leaves the buffer dirty rather than pretending it succeeded.
        if (allowingPrompts && leaving) {
          await this.offerSaveAs(file, `${quote(file.fileName)} could not be saved.`,
            `${error.message} Save the text somewhere else, or keep editing.`)
        } else if (allowingPrompts) {
          await this.alerts.error(`${quote(file.fileName)} could not be saved.`, error.message)
        } else {
          file.needsAttention = true
        }
    }
  }

  /**
   * A save failed on the way out of the file — switching, changing folder, closing the window —
   * and a bare OK would only bring the same failure round again. So the way out is offered:
   * the text written somewhere that can take it. There is deliberately no Discard: the working
   * copy is only offered back on reopening this file here, which a lost volume may never allow.
   * (A departure from Lolext, asked for.)
   */
  async offerSaveAs (file, title, message) {
    if (this.isClosing) await this.bridge.holdClose().catch(() => {})
    const choice = await this.alerts.present({
      title,
      message,
      buttons: [
        { title: 'Save As…' },
        { title: 'Keep Editing', cancel: true },
      ],
    })
    if (choice === 0) {
      try {
        const saved = await this.bridge.saveCopyAs(file.fileName, this.editor.text, file.lineEnding)
        if (saved) {
          // The text is safe elsewhere; the file where it was stays as it last was.
          file.isDirty = false
          file.needsAttention = false
          file.cancelRecovery()
          this.bridge.discardRecovery(file.path).catch(() => {})
          return
        }
      } catch (error) {
        await this.alerts.error('The text could not be saved there.', error.message)
      }
    }
    this.leaveRefused = true
  }

  /**
   * Exactly one prompt per external change: the flag is set the moment a prompt is raised *or*
   * deferred, so any number of further change events for the same file coalesce into the one
   * outstanding question.
   */
  async noteConflict (file, current, { allowingPrompts }) {
    file.conflictStamp = current
    if (file.conflictPending) return
    file.conflictPending = true
    if (allowingPrompts && this.isForeground) await this.presentConflict(file)
    else file.needsAttention = true
  }

  async presentConflict (file) {
    file.needsAttention = false
    file.conflictPending = true
    const choice = await this.alerts.present({
      title: `${quote(file.fileName)} changed on disk.`,
      message: 'There are unsaved changes here. Keep your version and write it over what is on disk, or reload from disk and discard your edits.',
      buttons: [
        { title: 'Keep My Version' },
        { title: 'Reload from Disk' },
      ],
    })
    file.conflictPending = false
    if (choice === 0) {
      // Adopt the stamp the file has now and go back through the one save path, so the write
      // is still checked against what is actually on disk.
      if (file.conflictStamp) file.lastStamp = file.conflictStamp
      file.conflictStamp = null
      file.needsAttention = false
      await this.save(file, { allowingPrompts: true })
    } else {
      file.conflictStamp = null
      file.needsAttention = false
      await this.reload(file)
    }
    this.notify()
  }

  /**
   * Replaces the buffer from disk, keeping scroll where it can. A file that cannot be read any
   * more closes quietly: the buffer it replaced is being thrown away regardless.
   */
  async reload (file) {
    try {
      const { text, lineEnding, stamp } = await this.bridge.readText(file.path)
      file.lineEnding = lineEnding
      file.lastStamp = stamp
      this.editor.reload(text)
      file.isDirty = false
      file.state = 'ready'
      this.bridge.discardRecovery(file.path).catch(() => {})
    } catch {
      this.dropOpenFile(file)
    }
    this.notify()
  }

  /**
   * The open file went away underneath a clean buffer: nothing to lose, so no alert — the pane
   * goes back to its empty state. (A departure from Lolext, asked for: a sync or checkout that
   * touches many files must not leave an alert per file to click through.)
   */
  dropOpenFile (file) {
    if (this.openFile !== file) return
    file.cancelRecovery()
    this.openFile = null
    if (this.selectedPath === file.path) this.selectedPath = null
    this.bridge.noteOpenFile(null).catch(() => {})
  }

  /**
   * The open file being deleted or moved out from under us leaves it open with its text intact
   * and marks it, and the next save asks where to put it rather than failing.
   */
  async requestRelocation (file, { allowingPrompts }) {
    if (!allowingPrompts || !this.isForeground) { file.needsAttention = true; return }
    if (file.conflictPending) return
    file.conflictPending = true
    const choice = await this.alerts.present({
      title: `${quote(file.fileName)} is no longer on disk.`,
      message: `Its text is still open here. Save it again at ${quote(file.path)}, or keep editing and decide later.`,
      buttons: [
        { title: 'Save Again' },
        { title: 'Keep Editing', cancel: true },
      ],
    })
    file.conflictPending = false
    if (choice === 0) {
      file.lastStamp = null                  // the file really is gone: no stamp to check
      file.state = 'ready'
      await this.save(file, { allowingPrompts: true })
    }
    this.notify()
  }

  /**
   * Files change behind the app's back. The app notices and handles it rather than waiting to
   * be asked:
   *
   *   clean buffer, file changed   → quietly reload it. Nothing to lose, so don't nag.
   *   dirty buffer, file changed   → ask once, naming the file. Never decide this one silently.
   *   clean buffer, file gone      → close it quietly; the pane shows its empty state.
   *   dirty buffer, file gone      → keep it open, keep the text, mark it. Ask on ⌘S or leaving.
   *   the app's own saves          → never trigger any of this.
   */
  async reconcileOpenFile () {
    const file = this.openFile
    if (!file || file.isSaving || file.state === 'loading') return
    let current
    try {
      current = await this.bridge.stamp(file.path)
    } catch {
      if (!file.isDirty) {
        this.dropOpenFile(file)
        this.notify()
      } else if (file.state !== 'missingOnDisk') {
        file.state = 'missingOnDisk'
        file.needsAttention = true
        this.notify()
      }
      return
    }
    if (file.state === 'missingOnDisk') { file.state = 'ready'; file.needsAttention = false }
    if (stampsMatch(current, file.lastStamp)) return

    if (!file.isDirty) { await this.reload(file); return }
    await this.noteConflict(file, current, { allowingPrompts: true })
    if (file.needsAttention) this.notify()
  }

  // MARK: - The working save

  bufferDidChange () {
    const file = this.openFile
    if (!file || file.state !== 'ready') return
    if (!file.isDirty) { file.isDirty = true; this.notify() }
    file.scheduleRecovery(() => this.writeRecovery(file))
  }

  async writeRecovery (file) {
    if (!file.isDirty) return
    await this.bridge.writeRecovery(file.path, this.editor.text).catch(() => {})
  }

  /**
   * Next launch, the file opens and a copy is waiting that says something different: **ask**.
   * Restoring leaves the buffer dirty — recovering is not saving.
   */
  async offerRecovery (file, diskText) {
    const waiting = await this.bridge.readRecovery(file.path, diskText).catch(() => null)
    if (!waiting) return
    const choice = await this.alerts.present({
      type: 'question',
      title: `Unsaved changes to ${quote(file.fileName)} were found.`,
      message: 'LoText kept a copy of text that was never written to disk. Restore it, or discard it and keep what is on disk?',
      buttons: [{ title: 'Restore' }, { title: 'Discard', cancel: true }],
    })
    if (choice === 0) {
      this.editor.load(waiting.text)
      this.editor.apply(this.settings.view)
      file.isDirty = true
    }
    await this.bridge.discardRecovery(file.path).catch(() => {})
    this.notify()
  }

  // MARK: - Making, renaming, duplicating, deleting

  /** Where a New File with no explicit parent lands: alongside the open file, else the root. */
  get defaultParent () {
    return this.openFile ? (FilePath.parent(this.openFile.path) ?? FilePath.ROOT) : FilePath.ROOT
  }

  /**
   * ⌘N. A markdown file: it lands in the tree as `Untitled.md` (deduplicated), opens focused
   * and empty, and goes straight into inline rename with the base name selected.
   */
  async newFile (parent) {
    if (!this.hasFolder) return
    const folder = parent ?? this.defaultParent
    // Before anything is created: a save that cannot go through must not leave a stray
    // Untitled.md in the tree that nothing opened.
    if (!await this.closeOpenFile()) return
    try {
      const path = await this.bridge.create('file', 'Untitled.md', folder)
      await this.tree.refresh()
      await this.tree.expandChain(path)
      await this.openFreshFile(path)
      this.pendingNewFile = path
      this.tree.beginRename(path)
    } catch (error) {
      await this.alerts.error('The file could not be created.', error.message)
    }
  }

  async newFolder (parent) {
    if (!this.hasFolder) return
    const folder = parent ?? this.defaultParent
    try {
      const path = await this.bridge.create('folder', 'untitled folder', folder)
      await this.tree.refresh()
      await this.tree.expandChain(path)
      this.tree.beginRename(path)
    } catch (error) {
      await this.alerts.error('The folder could not be created.', error.message)
    }
  }

  /**
   * Rename is otherwise unrestricted: any name is allowed, including one that renames a file
   * into a non-openable type. The alert says *which* of the two happened, because "you cannot
   * edit this any more" and "you cannot see this any more" are different losses and only one is
   * recoverable by renaming the file back.
   */
  async commitRename (path, proposed) {
    this.tree.renamingPath = null
    const isFirstNaming = this.pendingNewFile === path
    this.pendingNewFile = null
    let name = String(proposed ?? '').trim()
    if (!name || name === FilePath.name(path)) {
      // Naming was abandoned: hand the keyboard back to the new file's empty buffer.
      if (isFirstNaming && this.openFile?.path === path) this.editor?.focus()
      this.notify()
      return
    }
    // A name typed without an extension during that initial rename gets `.md`.
    if (isFirstNaming && !name.includes('.')) name += '.md'

    const leavesTheEditor = isBinary(name) && !isBinary(FilePath.name(path))
    if (leavesTheEditor) {
      const opensInAViewer = isPreviewable(name)
      const choice = await this.alerts.present({
        title: opensInAViewer
          ? `${quote(name)} will no longer be editable in LoText.`
          : `${quote(name)} will no longer open in LoText.`,
        message: opensInAViewer
          ? 'That extension opens in a viewer instead, so the file can still be seen here — but not edited.'
          : 'That extension is a known binary type, so the file stays in the sidebar but cannot be opened here.',
        buttons: [{ title: 'Rename' }, { title: 'Cancel', cancel: true }],
      })
      if (choice !== 0) { this.notify(); return }
    }
    await this.performRename(path, name)
  }

  async performRename (path, name) {
    try {
      const newPath = await this.bridge.rename(path, name)
      this.rewritePaths(path, newPath)
      await this.tree.refresh()
      if (this.openFile?.path === newPath) this.editor?.focus()
    } catch (error) {
      await this.alerts.error(`${quote(FilePath.name(path))} could not be renamed.`, error.message)
    }
    this.notify()
  }

  /**
   * A copy lands beside the original as `notes copy.md`, and the copy is what ends up
   * highlighted. The copy is **not** opened: duplicating is something you do to a file rather
   * than to a window.
   *
   * Unsaved text is written out first when the duplicate would otherwise miss it, so a copy is
   * never made from stale bytes.
   */
  async duplicate (path) {
    if (!path || FilePath.isRoot(path)) return
    const open = this.openFile?.path
    if (open && (open === path || FilePath.isDescendant(open, path))) {
      await this.saveIfDirty({ allowingPrompts: true })
    }
    try {
      const copy = await this.bridge.duplicate(path)
      await this.tree.refresh()
      await this.tree.expandChain(copy)
      this.selectedPath = copy
    } catch (error) {
      await this.alerts.error(`${quote(FilePath.name(path))} could not be duplicated.`, error.message)
    }
    this.notify()
  }

  /**
   * The only destructive action, so it is confirmed by name. A file on this machine goes to the
   * Trash and can be fetched back out of it; a file on a server has nowhere to go, so the alert
   * says the word rather than borrowing a reassurance that would not be true.
   */
  async requestDelete (path) {
    if (!path || FilePath.isRoot(path)) return
    const choice = await this.alerts.present(this.deleteQuestion(FilePath.name(path)))
    if (choice === 0) await this.performDelete(path)
  }

  /**
   * iOS has a Trash of sorts — Recently Deleted, in the Files app — but only where the location
   * keeps one, so its alert says both rather than promising either.
   */
  deleteQuestion (name) {
    const buttons = (title) => [{ title }, { title: 'Cancel', cancel: true }]
    if (this.isRemoteFolder) {
      return {
        title: `Delete ${quote(name)} from the server?`,
        message: 'There is no Trash on a server, so this cannot be undone.',
        buttons: buttons('Delete'),
      }
    }
    if (this.bridge.platform === 'ios') {
      return {
        title: `Delete ${quote(name)}?`,
        message: 'Where this folder keeps a Recently Deleted, you can put it back from there in the Files app. Elsewhere it cannot be undone.',
        buttons: buttons('Delete'),
      }
    }
    return {
      title: `Move ${quote(name)} to the Trash?`,
      message: 'You can put it back from the Trash.',
      buttons: buttons('Move to Trash'),
    }
  }

  async performDelete (path, options) {
    try {
      await this.bridge.remove(path, options)
      // Dropped, not saved: a save from a window standing over a file in the Trash would write
      // it straight back out again.
      if (this.openFile && (this.openFile.path === path ||
          FilePath.isDescendant(this.openFile.path, path))) {
        this.openFile.cancelRecovery()
        this.openFile = null
        this.bridge.noteOpenFile(null).catch(() => {})
      }
      if (this.previewPath === path || FilePath.isDescendant(this.previewPath ?? '', path)) {
        this.previewPath = null
        this.previewState = null
      }
      if (this.selectedPath === path || FilePath.isDescendant(this.selectedPath ?? '', path)) {
        this.selectedPath = null
      }
      await this.tree.refresh()
    } catch (error) {
      if (error.code === 'noTrash' && !options?.permanently) {
        // Finder's answer to a volume with no Trash: offer to delete it now, and say plainly
        // that this one cannot be put back.
        const choice = await this.alerts.present({
          title: `Delete ${quote(FilePath.name(path))} immediately?`,
          message: `${error.message} Deleting it immediately cannot be undone.`,
          buttons: [{ title: 'Delete' }, { title: 'Cancel', cancel: true }],
        })
        if (choice === 0) return this.performDelete(path, { permanently: true })
      } else {
        await this.alerts.error(`${quote(FilePath.name(path))} could not be deleted.`, error.message)
      }
    }
    this.notify()
  }

  /** ⌫ and ⌘⌫ both land here; only the confirmation differs. */
  async deleteSelected ({ confirming }) {
    const path = this.selectedPath
    if (!path || FilePath.isRoot(path)) return
    if (confirming) await this.requestDelete(path)
    else await this.performDelete(path)
  }

  // MARK: - Moving

  /**
   * Asked while the drag is still in the air, so a drop that could only fail is never accepted
   * in the first place: nothing moves into the folder it is already in, and no folder moves
   * inside itself.
   */
  canMove (path, destination) {
    if (!this.hasFolder || !path || FilePath.isRoot(path)) return false
    if (destination === path || FilePath.isDescendant(destination, path)) return false
    return destination !== (FilePath.parent(path) ?? FilePath.ROOT)
  }

  async move (path, destination) {
    if (!this.canMove(path, destination)) return
    try {
      const newPath = await this.bridge.move(path, destination)
      this.rewritePaths(path, newPath)
      await this.tree.refresh()
      await this.reconcileOpenFile()
      // Twirl the destination open, so what was just dropped is visible where it landed rather
      // than swallowed by a folder that stayed shut.
      await this.tree.expandChain(newPath)
    } catch (error) {
      await this.alerts.error(`${quote(FilePath.name(path))} could not be moved.`, error.message)
    }
    this.notify()
  }

  /** The open file and the highlight follow a rename or a move. */
  rewritePaths (from, to) {
    if (this.openFile) {
      const rewritten = FilePath.rewriting(this.openFile.path, from, to)
      if (rewritten !== null) {
        this.openFile.path = rewritten
        this.bridge.noteOpenFile(rewritten).catch(() => {})
      }
    }
    if (this.previewPath) {
      const rewritten = FilePath.rewriting(this.previewPath, from, to)
      if (rewritten !== null) this.previewPath = rewritten
    }
    if (this.selectedPath) {
      const rewritten = FilePath.rewriting(this.selectedPath, from, to)
      if (rewritten !== null) this.selectedPath = rewritten
    }
  }

  // MARK: - Recently edited files

  /** The files changed most recently on disk, newest first, minus the one on screen now. */
  recentFileChoices () {
    const current = this.openFile?.path ?? this.previewPath
    return (this.recentFiles ?? []).filter((path) => path !== current)
  }

  /** Always opens, even with nothing to list: the picker saying so beats a key that does nothing. */
  goToLastFile () {
    // ⇧⌘O again steps down a row rather than raising a second picker, so ⇧⌘O ⇧⌘O ↩ is two
    // files back without the hand leaving the shortcut.
    if (this.sheet === 'recentFiles') {
      this.moveRecentHighlight(1)
      return
    }
    this.recentHighlight = 0
    this.recentFiles = null
    this.showSheet('recentFiles')
    this.loadRecentFiles()
  }

  moveRecentHighlight (delta) {
    const count = this.recentFileChoices().length
    if (!count) return
    this.recentHighlight = Math.min(Math.max(0, this.recentHighlight + delta), count - 1)
    this.notify('sheet')
  }

  /**
   * Asked afresh each time the sheet opens, like ⇧⌘P's walk: the dates are the disk's, so an
   * edit made in another app or on the server counts, and there is nothing to keep up to date.
   */
  async loadRecentFiles () {
    if (!this.hasFolder) { this.recentFiles = []; this.notify('sheet'); return }
    this.recentToken += 1
    const token = this.recentToken
    const files = await this.bridge.recentlyEdited(token).catch(() => [])
    if (token !== this.recentToken || this.sheet !== 'recentFiles' || !files) return
    this.recentFiles = files.map((file) => file.path)
    this.recentHighlight = Math.min(this.recentHighlight,
      Math.max(0, this.recentFileChoices().length - 1))
    this.notify('sheet')
  }

  async openHighlightedRecentFile () {
    const choice = this.recentFileChoices()[this.recentHighlight]
    this.closeSheet()
    if (choice) await this.openPath(choice)
  }

  // MARK: - Sheets

  showSheet (name) {
    this.sheet = name
    this.notify('sheet')
  }

  closeSheet () {
    if (!this.sheet) return
    this.sheet = null
    this.notify('sheet')
  }

  // MARK: - Printing

  /** ⌘P prints the open file only — never the whole folder, never a selection. */
  async print () {
    const file = this.openFile
    if (!file || file.state !== 'ready') return
    await this.saveIfDirty({ allowingPrompts: true })
    try {
      await this.bridge.print({ text: this.editor.text, fileName: file.fileName })
    } catch (error) {
      await this.alerts.error('That could not be printed.', error.message)
    }
  }

  // MARK: - Commands from the menu

  async runCommand (command, payload) {
    switch (command) {
      case 'newFile': await this.newFile(null); break
      case 'newFolder': await this.newFolder(null); break
      case 'duplicate': await this.duplicate(this.selectedPath); break
      case 'openFolder': await this.openFolder(); break
      case 'connectToServer': this.showSheet('connect'); break
      case 'helpTasks':
      case 'helpDisclosures':
      case 'helpMarkdown': this.showSheet(command); break
      case 'openRecentFolder': await this.openRecent(payload); break
      case 'clearRecentFolders': await this.bridge.clearRecentFolders(); this.bridge.rebuildMenu(); break
      case 'goToLastFile': this.goToLastFile(); break
      case 'findFile': if (this.hasFolder) this.showSheet('findFile'); break
      case 'closeFile': await this.closeFileCommand(); break
      case 'save': await this.saveIfDirty({ allowingPrompts: true }); break
      case 'print': await this.print(); break
      case 'refresh': await this.refreshFolder(); break
      case 'toggleSidebar': this.sidebarVisible = !this.sidebarVisible; this.notify('layout'); break
      case 'deleteImmediately': await this.deleteImmediately(); break
      case 'selectNextInstance': this.editor?.selectNextInstance(); break
      case 'moveLineUp': this.editor?.moveLinesUp(); break
      case 'moveLineDown': this.editor?.moveLinesDown(); break
      case 'bold': this.editor?.toggleBold(); break
      case 'cutAndSendToDayCap': await this.cutAndSendToDayCap(); break
      case 'italic': this.editor?.toggleItalic(); break
      case 'find': this.editor?.find(); break
      case 'findAndReplace': this.editor?.findAndReplace(); break
      case 'findNext': this.editor?.findNext(); break
      case 'findPrevious': this.editor?.findPrevious(); break
      case 'useSelectionForFind': this.editor?.useSelectionForFind(); break
      default: break
    }
  }

  /**
   * ⌘⌫ **routes**, at the moment of the press. In any text — the editor's buffer, or the field
   * editor behind a rename or a search box — it is the platform's delete-to-beginning-of-line.
   * Only with the sidebar list itself holding the keyboard does it delete the highlighted row,
   * immediately, without asking.
   *
   * Read from the focus *now*, never from `isEditingText`: that flag trails focus events, and a
   * stale one once sent a ⌘⌫ typed in the editor to the Trash with the open file. Anywhere that
   * is neither text nor the sidebar list, the press does nothing.
   */
  async deleteImmediately () {
    if (this.editor?.isFocused) {
      this.editor.deleteToLineStart()
      return
    }
    const active = document.activeElement
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' ||
        active.isContentEditable)) {
      document.execCommand('delete')
      return
    }
    if (!active?.classList.contains('sidebar-list')) return
    await this.deleteSelected({ confirming: false })
  }

  /** Which kind of thing has the keyboard, for the one menu item that has to know. */
  noteKeyboardLocation () {
    const active = document.activeElement
    const inText = Boolean(active && (
      active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' ||
      active.isContentEditable))
    if (inText !== this.isEditingText) {
      this.isEditingText = inText
      this.reportMenuState()
    }
  }
}

function addressOf (location) {
  const authority = location.user ? `${location.user}@${location.host}` : location.host
  return location.port
    ? `ssh://${authority}:${location.port}${location.path.startsWith('/') ? '' : '/'}${location.path}`
    : `${authority}:${location.path}`
}
