// A folder that is not on this machine, behind the same door as one that is.
//
// This goes **behind** the store interface, not beside it: nothing above it — the tree, the
// open file, the editor, the printer, the working save — knows there is such a thing as a
// remote folder. Every question is asked in the same paths, bytes and stamps as before.
//
// **One SSH connection and one shell script.** Every operation hands the far side a small POSIX
// shell program (`./remote-script.js`) with a verb, and one operation is one round trip. How the
// command gets there is the **transport**, the one part the two platforms do differently: on
// the Mac it is `/usr/bin/ssh` over a multiplexed master (`src/main/store/ssh-transport.js`); on
// iPhone and iPad it is the native plugin, which keeps a connection open in the app itself
// (`src/mobile/ssh-transport.js`). Everything else — the paths, the stamps, the conflict check,
// the naming — is this file, so the two cannot drift apart.
//
// A transport has three methods:
//
//   prepare ()                                    — before the first connection: a key to offer
//   run ({ location, command, input, timeout })   → { status, output, diagnostic }
//                                                    rejects a StoreError `refused` or
//                                                    `unreachable` when it never got as far as
//                                                    running the command
//   close (location)                              — hangs the connection up
//
// **Three things a remote folder does not have, all said out loud rather than faked.** There
// is no Trash on a server, so the delete confirmation says "delete" and means it. There is no
// watcher for a machine that is not this one, so ⌘R is what replaces it. And there is no local
// location, so Open in Finder is not offered and a preview that needs a file is fetched first.

import * as FilePath from '../file-path.js'
import { conflict, notFound, nameTaken, StoreError, folderUnavailable } from './errors.js'
import { SOURCE, STATUS, parseEntry, parseStamp, quoted } from './remote-script.js'
import { displayName, identity } from './remote-location.js'
import { compareNodes, copyName, numberedName, splitName, isHidden } from './names.js'

/** Paths per `stamps` round trip, well inside any server's limit on a command line's length. */
const STAMP_BATCH = 200

/** `ssh`'s own exit status: it never got as far as running the command. */
const SSH_FAILED = 255

const decoder = new TextDecoder()
const text = (bytes) => decoder.decode(bytes)

export class RemoteStore {
  constructor (location, transport) {
    this.location = location
    this.transport = transport
    this.kind = 'remote'
    this.absoluteRoot = ''
    this.reachable = true
    // Each listing is a round trip of its own; eight at once could run into the server's
    // MaxSessions.
    this.listingConcurrency = 1
  }

  get root () { return identity(this.location) }
  get rootName () { return displayName(this.location) }
  get identity () { return identity(this.location) }
  get isUnavailable () { return !this.reachable }

  get capabilities () {
    return { trash: false, watcher: false, localPath: false }
  }

  /** The far end's absolute path for a file in the tree. */
  remotePath (relative) {
    const parts = FilePath.components(relative)
    if (!parts.length) return this.absoluteRoot
    const base = this.absoluteRoot
    return base.endsWith('/') ? base + parts.join('/') : `${base}/${parts.join('/')}`
  }

  localURL () { return null }

  // MARK: - Connecting

  /**
   * Makes sure there is a key to offer, opens the connection, and settles what the opened
   * folder's absolute path is. Every path sent afterwards is built from it, so nothing depends
   * on where a login shell happens to start and `~/notes` is resolved exactly once.
   */
  async connect () {
    await this.transport.prepare?.()
    const answer = await this.send('hello', [this.location.path], { timeout: 25000 })
    const resolved = text(answer).trim()
    if (!resolved) throw new StoreError('failed', 'The server answered with nothing.')
    this.absoluteRoot = resolved
    this.reachable = true
  }

  /** What the "folder unavailable" banner is redrawn from when the app comes to the front. */
  async refreshAvailability () {
    try {
      await this.send('exists', [this.absoluteRoot], { timeout: 15000 })
      this.reachable = true
    } catch {
      this.reachable = false
    }
    return this.reachable
  }

  /**
   * Hangs up the connection. It would time out on its own, but a folder closed is a login that
   * should end with it rather than linger on a machine the user has finished with.
   */
  close () {
    Promise.resolve(this.transport.close?.(this.location)).catch(() => {})
  }

  // MARK: - Listing

  async children (relative) {
    const output = await this.send('list', [this.remotePath(relative)])
    const nodes = []
    for (const line of text(output).split('\n')) {
      if (!line) continue
      const entry = parseEntry(line)
      if (!entry) continue
      const name = entry.name.slice(entry.name.lastIndexOf('/') + 1)
      if (isHidden(name)) continue
      nodes.push({
        path: FilePath.appending(relative, name),
        kind: entry.isFolder ? 'folder' : 'file',
        isLink: false,
        leavesTheFolder: false,
      })
    }
    nodes.sort(compareNodes)
    return nodes
  }

  // MARK: - Reading and writing

  async read (relative) {
    const output = await this.send('read', [this.remotePath(relative)])
    // The stamp is the first line; everything after it is the file.
    const newline = output.indexOf(0x0A)
    if (newline < 0) throw notFound(relative)
    const stamp = parseStamp(text(output.subarray(0, newline)))
    if (!stamp) throw notFound(relative)
    return { data: output.subarray(newline + 1), stamp }
  }

  /**
   * The check-then-write promise survives the network: the stamp comparison and the write are
   * done by the remote shell *in one command*, so a file that moved under the app refuses the
   * save and hands back the stamp it really has — which is the same conflict prompt as ever.
   */
  async write (data, relative, expected) {
    const want = expected ? String(Math.floor(expected.modified / 1000)) : '-'
    try {
      const output = await this.send('write', [this.remotePath(relative), want], { input: data })
      const stamp = parseStamp(text(output).trim())
      if (!stamp) throw new StoreError('failed', 'The server did not report the file back.')
      return stamp
    } catch (error) {
      if (error.status === STATUS.conflict) {
        const current = parseStamp(text(error.output).trim())
        throw conflict(current ?? { modified: Date.now(), size: -1 })
      }
      if (error.status === STATUS.notFound) throw notFound(relative)
      throw this.translate(error, relative)
    }
  }

  async stamp (relative) {
    const output = await this.send('stat', [this.remotePath(relative)])
    const stamp = parseStamp(text(output).trim())
    if (!stamp) throw notFound(relative)
    return stamp
  }

  /**
   * The modified time of each of `paths`, in milliseconds, or null for one the server cannot
   * stat: one round trip per batch rather than one per file.
   */
  async modifiedTimes (paths) {
    const times = new Map()
    for (let start = 0; start < paths.length; start += STAMP_BATCH) {
      const batch = paths.slice(start, start + STAMP_BATCH).map((relative) => this.remotePath(relative))
      const output = await this.send('stamps', batch)
      for (const line of text(output).split('\n')) {
        const entry = line && parseEntry(line)
        if (entry) times.set(entry.name, entry.stamp.modified)
      }
    }
    return paths.map((relative) => times.get(this.remotePath(relative)) ?? null)
  }

  async exists (relative) {
    try {
      await this.send('exists', [this.remotePath(relative)])
      return true
    } catch {
      return false
    }
  }

  // MARK: - Mutations

  async create (kind, name, parentPath) {
    const output = await this.send('create', [kind, this.remotePath(parentPath), name])
    return FilePath.appending(parentPath, text(output).trim())
  }

  async rename (relative, newName) {
    const parent = FilePath.parent(relative) ?? FilePath.ROOT
    const destination = FilePath.appending(parent, newName)
    if (destination === relative) return relative
    try {
      await this.send('move', [this.remotePath(relative), this.remotePath(destination)])
    } catch (error) {
      if (error.status === STATUS.nameTaken) throw nameTaken(newName)
      throw this.translate(error, relative)
    }
    return destination
  }

  /**
   * The far side refuses a taken name inside the one command, so a refusal just means try the
   * next in the series — `validation-2.md`, `validation-3.md` — and nothing is overwritten.
   */
  async move (relative, destinationFolder) {
    const name = FilePath.name(relative)
    for (let counter = 1; ; counter += 1) {
      const destination = FilePath.appending(destinationFolder,
        counter === 1 ? name : numberedName(name, counter))
      try {
        await this.send('move', [this.remotePath(relative), this.remotePath(destination)])
        return destination
      } catch (error) {
        if (error.status === STATUS.nameTaken && counter < 1000) continue
        if (error.status === STATUS.nameTaken) throw nameTaken(name)
        throw this.translate(error, relative)
      }
    }
  }

  async duplicate (relative) {
    const parent = FilePath.parent(relative) ?? FilePath.ROOT
    const output = await this.send('copy', [
      this.remotePath(relative), this.remotePath(parent), copyName(FilePath.name(relative)),
    ])
    return FilePath.appending(parent, text(output).trim())
  }

  /** There is no Trash on a server. The confirmation said so; this does what it said. */
  async delete (relative) {
    await this.send('delete', [this.remotePath(relative)])
  }

  async uniqueName (parentPath, name) {
    // The far side picks the free name itself, inside `create`. This is only for the callers
    // that want to propose one, and one round trip is cheaper than a loop of them.
    if (!await this.exists(FilePath.appending(parentPath, name))) return name
    const { stem, extension } = splitName(name)
    return `${stem} 2${extension}`
  }

  startWatching () { /* There is no watcher for a machine that is not this one. ⌘R is it. */ }
  stopWatching () {}

  // MARK: - Running one verb

  /**
   * One verb, one round trip. A non-zero exit becomes a failure carrying the status and
   * whatever the script managed to print first — for a refused save, that is the stamp the
   * file actually has, which is exactly what the conflict prompt needs.
   */
  async send (verb, args, { input = null, timeout = 30000 } = {}) {
    const command = ['/bin/sh', '-c', quoted(SOURCE), 'lotext', quoted(verb), ...args.map(quoted)].join(' ')
    let result
    try {
      result = await this.transport.run({ location: this.location, command, input, timeout })
    } catch (error) {
      this.reachable = false
      throw error
    }
    const { status, output, diagnostic } = result
    if (status === 0) {
      this.reachable = true
      return output
    }
    // 255 is `ssh` itself rather than the script: it never got as far as running a command,
    // so this is about the connection and the connection is now suspect.
    if (status === SSH_FAILED) {
      this.reachable = false
      throw connectionError(diagnostic)
    }
    const failure = new StoreError('remote', diagnostic || `The server refused (${status}).`)
    failure.status = status
    failure.output = output
    throw failure
  }

  translate (error, relative) {
    if (error instanceof StoreError && error.code !== 'remote') return error
    switch (error.status) {
      case STATUS.notFound: return notFound(relative)
      case STATUS.noSuchFolder: return folderUnavailable()
      case STATUS.nameTaken: return nameTaken(FilePath.name(relative))
      default: return error
    }
  }
}

/**
 * `ssh`'s own failures, read off what it printed. The distinction worth making is only ever
 * "it would not let us in" against "we could not get there", because those are the two things
 * a user can do something about and they are different things.
 */
export function connectionError (diagnostic) {
  const lower = diagnostic.toLowerCase()
  if (lower.includes('permission denied') || lower.includes('authentication') ||
      lower.includes('host key verification failed')) {
    return new StoreError('refused', diagnostic || 'The server refused the key.')
  }
  return new StoreError('unreachable', diagnostic || 'The server could not be reached.')
}
