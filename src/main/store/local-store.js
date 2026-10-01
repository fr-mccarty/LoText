// The one door to the file system, for a folder on this machine.
//
// Every part of the app asks the store for files and waits for the answer. Nothing else
// touches the disk. That is not ceremony: getting line endings right and deciding "has this
// changed?" are each easy to get wrong, and each wants to be written exactly once.
//
// It hands out **bytes**, not text. Turning bytes into text — and deciding what the line
// endings were — happens once, above this, instead of at every place that reads a file.
//
// A file is named by its path *relative to the folder you opened*, so a file keeps its
// identity even if the folder itself gets moved or renamed around it.

import { promises as fs, watch as watchPath, realpathSync } from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import * as FilePath from '../../shared/file-path.js'
import { makeStamp, stampsMatch } from '../../shared/file-stamp.js'
import { conflict, notFound, nameTaken, folderUnavailable, StoreError } from '../../shared/store/errors.js'
import { isHidden, numberedName, copyName, splitName, compareNodes } from '../../shared/store/names.js'

/** ~300ms, so a burst of writes from a sync engine is one refresh rather than twenty. */
const WATCH_DEBOUNCE = 300

/** How many files are stat-ed at once for their dates: enough to be quick, few enough to be polite. */
const STAT_BATCH = 64

export class LocalStore {
  constructor (root) {
    this.root = root
    this.kind = 'local'
    this.unavailable = false
    this.watcher = null
    this.watchTimer = null
    this.onChange = null
  }

  get rootName () {
    return path.basename(this.root) || this.root
  }

  get identity () {
    return this.root
  }

  get isUnavailable () {
    return this.unavailable
  }

  /**
   * On a mounted volume — a network share, an external drive — rather than the startup disk:
   * everything mounted on a Mac is under `/Volumes`. The real path decides, so a folder reached
   * through a link into a share counts, and `/Volumes/Macintosh HD`, a link to `/`, does not.
   */
  get isMounted () {
    if (this.mounted === undefined) {
      let real = this.root
      try { real = realpathSync(this.root) } catch {}
      this.mounted = real.startsWith('/Volumes/')
    }
    return this.mounted
  }

  /** The three things a folder on a server does not have; a local one has all of them. */
  get capabilities () {
    return { trash: true, watcher: true, localPath: true }
  }

  // MARK: - Resolving

  /** The real location of a relative path. The only place a `FilePath` becomes an absolute one. */
  resolve (relative) {
    const parts = FilePath.components(relative)
    return parts.length ? path.join(this.root, ...parts) : this.root
  }

  localURL (relative) {
    return this.resolve(relative)
  }

  /**
   * Where a link actually points. Only "Open as Folder" asks: going *to* the far end is the
   * rarer of the two wants, so it is asked for rather than assumed — the link twirls open in
   * place like every other folder.
   */
  async linkTarget (relative) {
    try {
      return await fs.realpath(this.resolve(relative))
    } catch {
      return null
    }
  }

  // MARK: - Listing

  /**
   * One level. Asks for the name and for whether the entry is a directory, and for nothing
   * else — no size, no date, no contents — so listing a synced folder never faults one byte
   * of it down.
   *
   * A symbolic link is listed as **what it points at**, not as what the directory entry is:
   * a link to a folder answers `isDirectory` false for the entry and would otherwise land
   * among the files, which is what happens to a mounted share linked onto the Desktop.
   */
  async children (relative) {
    const directory = this.resolve(relative)
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw notFound(relative)
      if (error.code === 'EACCES' || error.code === 'EPERM') throw new StoreError('denied', 'That folder cannot be read.')
      throw error
    }

    const nodes = []
    for (const entry of entries) {
      if (isHidden(entry.name)) continue
      const childPath = FilePath.appending(relative, entry.name)
      const isLink = entry.isSymbolicLink()
      let isFolder = entry.isDirectory()
      let leavesTheFolder = false

      if (isLink) {
        // Follow it: `fs.stat` resolves the link, and a link to a folder is a folder row.
        // A link to *nothing* — an unmounted share, a folder since deleted — stays a file
        // row. Better that than a folder that cannot be opened.
        try {
          const target = await fs.stat(path.join(directory, entry.name))
          isFolder = target.isDirectory()
          const resolved = await fs.realpath(path.join(directory, entry.name))
          leavesTheFolder = !isInside(resolved, this.root)
        } catch {
          isFolder = false
        }
      }

      nodes.push({ path: childPath, kind: isFolder ? 'folder' : 'file', isLink, leavesTheFolder })
    }

    // Folders sort before files; both sort case-insensitively by name.
    nodes.sort(compareNodes)
    return nodes
  }

  // MARK: - Reading and writing

  async read (relative) {
    const target = this.resolve(relative)
    try {
      const [data, stats] = await Promise.all([fs.readFile(target), fs.stat(target)])
      return { data, stamp: makeStamp(stats.mtimeMs, stats.size) }
    } catch (error) {
      if (error.code === 'ENOENT') throw notFound(relative)
      throw error
    }
  }

  /**
   * **The only function in the app that writes a file.** It re-reads the on-disk stamp
   * immediately before writing and, when `expected` does not match, writes nothing and
   * throws a conflict. `expected` is null only for a file just created, or for one that has
   * gone missing and is being put back.
   *
   * The write is **in place** — the same file, not a new one swapped in. A replaced inode
   * reads to a sync engine as a delete-plus-create, which churns versions and can surface as
   * a conflict on another device.
   */
  async write (data, relative, expected) {
    const target = this.resolve(relative)
    if (expected) {
      let current
      try {
        const stats = await fs.stat(target)
        current = makeStamp(stats.mtimeMs, stats.size)
      } catch (error) {
        if (error.code === 'ENOENT') throw notFound(relative)
        throw error
      }
      if (!stampsMatch(current, expected)) throw conflict(current)
    }

    let handle
    try {
      // `r+` when the file is there, so the inode is preserved; `w` only for a file that is
      // genuinely being created.
      handle = await fs.open(target, expected === null ? 'w' : 'r+').catch(async (error) => {
        if (error.code === 'ENOENT') return fs.open(target, 'w')
        throw error
      })
      await handle.truncate(0)
      await handle.write(data, 0, data.length, 0)
      await handle.sync().catch(() => {})
    } finally {
      await handle?.close()
    }

    const stats = await fs.stat(target)
    return makeStamp(stats.mtimeMs, stats.size)
  }

  async stamp (relative) {
    try {
      const stats = await fs.stat(this.resolve(relative))
      return makeStamp(stats.mtimeMs, stats.size)
    } catch (error) {
      if (error.code === 'ENOENT') throw notFound(relative)
      throw error
    }
  }

  /**
   * The modified time of each of `paths`, in milliseconds, or null for one that cannot be read.
   * A stat reads no contents, so a dataless synced file is not faulted down.
   */
  async modifiedTimes (paths) {
    const times = []
    for (let start = 0; start < paths.length; start += STAT_BATCH) {
      const batch = paths.slice(start, start + STAT_BATCH)
      times.push(...await Promise.all(batch.map((relative) =>
        fs.stat(this.resolve(relative)).then((stats) => Math.round(stats.mtimeMs), () => null))))
    }
    return times
  }

  async exists (relative) {
    try {
      await fs.lstat(this.resolve(relative))
      return true
    } catch {
      return false
    }
  }

  /** The folder itself, checked rather than assumed: a volume can be ejected mid-session. */
  async refreshAvailability () {
    try {
      const stats = await fs.stat(this.root)
      this.unavailable = !stats.isDirectory()
    } catch {
      this.unavailable = true
    }
    return !this.unavailable
  }

  // MARK: - Mutations

  async create (kind, name, parentPath) {
    const parent = this.resolve(parentPath)
    const unique = await this.uniqueName(parentPath, name)
    const target = path.join(parent, unique)
    try {
      if (kind === 'folder') await fs.mkdir(target)
      else await fs.writeFile(target, '', { flag: 'wx' })
    } catch (error) {
      if (error.code === 'EEXIST') throw nameTaken(unique)
      if (error.code === 'ENOENT') throw folderUnavailable()
      throw error
    }
    return FilePath.appending(parentPath, unique)
  }

  async rename (relative, newName) {
    const parent = FilePath.parent(relative) ?? FilePath.ROOT
    const destination = FilePath.appending(parent, newName)
    if (destination === relative) return relative
    // A rename that only changes case is the same file on a case-insensitive volume, so the
    // existence check would refuse it. Nothing is overwritten either way.
    if (destination.toLowerCase() !== relative.toLowerCase() && await this.exists(destination)) {
      throw nameTaken(newName)
    }
    await fs.rename(this.resolve(relative), this.resolve(destination))
    return destination
  }

  /** Re-parenting is the whole of the move: a row keeps its name and lands inside a folder. */
  /**
   * Never onto a name already there: `validation.md` lands as `validation-2.md`, then
   * `validation-3.md`, and nothing in the destination is overwritten.
   */
  async move (relative, destinationFolder) {
    const name = FilePath.name(relative)
    let destination = FilePath.appending(destinationFolder, name)
    for (let counter = 2; await this.exists(destination); counter += 1) {
      destination = FilePath.appending(destinationFolder, numberedName(name, counter))
    }
    await moveEntry(this.resolve(relative), this.resolve(destination))
    return destination
  }

  /**
   * A copy beside the original, named the way Finder names one: `notes.md` → `notes copy.md`
   * → `notes copy 2.md`, with the extension left where it is. A folder is copied whole.
   */
  async duplicate (relative) {
    const parent = FilePath.parent(relative) ?? FilePath.ROOT
    const name = await this.uniqueName(parent, copyName(FilePath.name(relative)))
    const destination = FilePath.appending(parent, name)
    await fs.cp(this.resolve(relative), this.resolve(destination), { recursive: true })
    return destination
  }

  /**
   * To the Trash, where it can be fetched back out again. A volume without one — an SMB share,
   * most network and some USB disks — refuses, and that is answered with `noTrash` rather than
   * quietly unlinking: only once the user has said so is it removed `permanently`.
   */
  async delete (relative, { permanently = false } = {}) {
    const target = this.resolve(relative)
    if (permanently) {
      await fs.rm(target, { recursive: true })
      return
    }
    try {
      await shell.trashItem(target)
    } catch (error) {
      if (!await this.exists(relative)) throw error
      throw new StoreError('noTrash', error.message)
    }
  }

  /** `Untitled.md`, `Untitled 2.md`, … — the first name in that series nothing else holds. */
  async uniqueName (parentPath, name) {
    if (!await this.exists(FilePath.appending(parentPath, name))) return name
    const { stem, extension } = splitName(name)
    let counter = 2
    for (;;) {
      const candidate = `${stem} ${counter}${extension}`
      if (!await this.exists(FilePath.appending(parentPath, candidate))) return candidate
      counter += 1
    }
  }

  // MARK: - Watching

  /**
   * Watch the **folder**, not the open file. A sync engine replaces a file instead of editing
   * it, so a watch pinned to one file quietly goes deaf and stops reporting.
   *
   * It reports that *something* under the root changed and never *what*, which is also why
   * there is no search index anywhere in this app.
   */
  startWatching (onChange) {
    this.onChange = onChange
    this.stopWatching()
    try {
      this.watcher = watchPath(this.root, { recursive: true, persistent: false }, () => {
        clearTimeout(this.watchTimer)
        this.watchTimer = setTimeout(() => this.onChange?.(), WATCH_DEBOUNCE)
      })
      this.watcher.on('error', () => { this.unavailable = true; this.onChange?.() })
    } catch {
      this.watcher = null                   // a folder that cannot be watched still opens
    }
  }

  stopWatching () {
    clearTimeout(this.watchTimer)
    this.watchTimer = null
    this.watcher?.close()
    this.watcher = null
  }

  close () {
    this.stopWatching()
  }
}

function isInside (target, root) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * What Finder does. A rename only moves a directory entry, so it cannot leave its disk: a
 * folder linked onto the Desktop from a mounted share, a USB drive, a second internal disk
 * all answer `EXDEV`. Then the entry is copied, the copy checked, and only then the original
 * removed. A copy that fails or does not match is taken away again and the original left be.
 */
export async function moveEntry (source, target) {
  try {
    await fs.rename(source, target)
    return
  } catch (error) {
    if (error.code !== 'EXDEV') throw error
  }
  try {
    await fs.cp(source, target, {
      recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, verbatimSymlinks: true
    })
    await checkCopy(source, target)
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  await fs.rm(source, { recursive: true })
}

/** Small files are compared byte for byte, larger ones by size; links by where they point. */
const COMPARE_LIMIT = 4 * 1024 * 1024

async function checkCopy (source, copy) {
  const [original, copied] = await Promise.all([fs.lstat(source), fs.lstat(copy)])
  const mismatch = () => new Error(`The copy of ${path.basename(source)} does not match the original.`)
  if (original.isSymbolicLink()) {
    if (!copied.isSymbolicLink() || await fs.readlink(source) !== await fs.readlink(copy)) throw mismatch()
  } else if (original.isDirectory()) {
    if (!copied.isDirectory()) throw mismatch()
    const names = await fs.readdir(source)
    if ((await fs.readdir(copy)).length !== names.length) throw mismatch()
    for (const name of names) await checkCopy(path.join(source, name), path.join(copy, name))
  } else {
    if (!copied.isFile() || copied.size !== original.size) throw mismatch()
    if (original.size <= COMPARE_LIMIT) {
      const [a, b] = await Promise.all([fs.readFile(source), fs.readFile(copy)])
      if (!a.equals(b)) throw mismatch()
    }
  }
}
