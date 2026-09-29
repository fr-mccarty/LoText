// The one door to the file system on iOS, for the folder the app is holding open.
//
// The same contract as src/main/store/local-store.js, and the same rules: it hands out bytes,
// names files by their path relative to the folder, re-checks a file's stamp immediately before
// writing it, and writes in place. The native side does the coordinated reading and writing a
// folder another app vends (iCloud Drive, a file provider) asks for; the naming rules — how a
// copy or a moved file is renamed — are the shared ones, so they come out the same as on the Mac.

import * as FilePath from '../shared/file-path.js'
import { makeStamp } from '../shared/file-stamp.js'
import { conflict, notFound, nameTaken, folderUnavailable, StoreError } from '../shared/store/errors.js'
import { numberedName, copyName, splitName, compareNodes, isHidden } from '../shared/store/names.js'
import { Native, fromBase64, toBase64 } from './native.js'

/** The native side's error codes, turned into the vocabulary every store speaks. */
function translate (error, relative) {
  const code = error?.code
  if (code === 'notFound') return notFound(relative)
  if (code === 'nameTaken') return nameTaken(FilePath.name(relative))
  if (code === 'folderUnavailable') return folderUnavailable()
  if (code === 'denied') return new StoreError('denied', 'That cannot be read here.')
  if (code === 'conflict') {
    const current = error.data ?? {}
    return conflict(makeStamp(current.modified ?? 0, current.size ?? 0))
  }
  return new StoreError('failed', error?.message ?? String(error))
}

async function ask (method, options, relative) {
  try {
    return await Native[method](options)
  } catch (error) {
    throw translate(error, relative ?? options?.path ?? '')
  }
}

export class MobileStore {
  /** `folder` is what the native side answered when it opened one: `{ id, name, detail, path }`. */
  constructor (folder) {
    this.id = folder.id
    /** Where it is on disk — only for filing reading positions, never for reaching a file. */
    this.rootPath = folder.path ?? null
    this.name = folder.name
    this.detail = folder.detail ?? ''
    this.kind = 'local'
    this.unavailable = false
  }

  get rootName () { return this.name }
  get identity () { return this.id }
  get isUnavailable () { return this.unavailable }

  /**
   * Deleting goes to Recently Deleted where the location keeps one. There is nothing watching
   * the folder — iOS offers no such thing for a folder another app vends — and no Finder to
   * reveal a file in.
   */
  get capabilities () {
    return { trash: true, watcher: false, localPath: false }
  }

  // MARK: - Listing

  /** One level, folders first, hidden names left out — as on the Mac. */
  async children (relative) {
    const { entries } = await ask('list', { path: relative })
    return entries
      .filter((entry) => !isHidden(entry.name))
      .map((entry) => ({
        path: FilePath.appending(relative, entry.name),
        kind: entry.isFolder ? 'folder' : 'file',
        isLink: Boolean(entry.isLink),
        leavesTheFolder: Boolean(entry.leavesTheFolder),
      }))
      .sort(compareNodes)
  }

  // MARK: - Reading and writing

  async read (relative) {
    const { data, modified, size } = await ask('read', { path: relative })
    return { data: fromBase64(data), stamp: makeStamp(modified, size) }
  }

  /**
   * **The only function on iOS that writes a file.** The stamp check and the write happen in one
   * native call, inside one file coordination, so nothing can land between them.
   */
  async write (data, relative, expected) {
    const { modified, size } = await ask('write', {
      path: relative,
      data: toBase64(data),
      expected: expected ? { modified: expected.modified, size: expected.size } : null,
    })
    return makeStamp(modified, size)
  }

  async stamp (relative) {
    const { modified, size } = await ask('stat', { path: relative })
    return makeStamp(modified, size)
  }

  /** The modified time of each of `paths`, in milliseconds, or null for one that cannot be read. */
  async modifiedTimes (paths) {
    const { times } = await ask('modifiedTimes', { paths })
    return times
  }

  async exists (relative) {
    try {
      const { exists } = await Native.exists({ path: relative })
      return exists
    } catch {
      return false
    }
  }

  async refreshAvailability () {
    try {
      const { available } = await Native.folderAvailable()
      this.unavailable = !available
    } catch {
      this.unavailable = true
    }
    return !this.unavailable
  }

  // MARK: - Mutations

  async create (kind, name, parentPath) {
    const unique = await this.uniqueName(parentPath, name)
    const target = FilePath.appending(parentPath, unique)
    await ask(kind === 'folder' ? 'createFolder' : 'createFile', { path: target })
    return target
  }

  async rename (relative, newName) {
    const parent = FilePath.parent(relative) ?? FilePath.ROOT
    const destination = FilePath.appending(parent, newName)
    if (destination === relative) return relative
    // A rename that only changes case is the same file on a case-insensitive volume.
    if (destination.toLowerCase() !== relative.toLowerCase() && await this.exists(destination)) {
      throw nameTaken(newName)
    }
    await ask('move', { from: relative, to: destination }, relative)
    return destination
  }

  /** Never onto a name already there: `notes.md` lands as `notes-2.md`, then `notes-3.md`. */
  async move (relative, destinationFolder) {
    const name = FilePath.name(relative)
    let destination = FilePath.appending(destinationFolder, name)
    for (let counter = 2; await this.exists(destination); counter += 1) {
      destination = FilePath.appending(destinationFolder, numberedName(name, counter))
    }
    await ask('move', { from: relative, to: destination }, relative)
    return destination
  }

  /** `notes.md` → `notes copy.md` → `notes copy 2.md`, beside the original. A folder is copied whole. */
  async duplicate (relative) {
    const parent = FilePath.parent(relative) ?? FilePath.ROOT
    const name = await this.uniqueName(parent, copyName(FilePath.name(relative)))
    const destination = FilePath.appending(parent, name)
    await ask('copy', { from: relative, to: destination }, relative)
    return destination
  }

  async delete (relative) {
    await ask('trash', { path: relative })
  }

  /** `Untitled.md`, `Untitled 2.md`, … — the first name in that series nothing else holds. */
  async uniqueName (parentPath, name) {
    if (!await this.exists(FilePath.appending(parentPath, name))) return name
    const { stem, extension } = splitName(name)
    for (let counter = 2; ; counter += 1) {
      const candidate = `${stem} ${counter}${extension}`
      if (!await this.exists(FilePath.appending(parentPath, candidate))) return candidate
    }
  }

  close () {}
}
