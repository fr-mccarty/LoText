// A folder that is not on this machine, behind the same door as one that is.
//
// This goes **behind** the store interface, not beside it: nothing above it — the tree, the
// open file, the editor, the printer, the working save — knows there is such a thing as a
// remote folder. Every question is asked in the same paths, bytes and stamps as before.
//
// **One SSH connection, multiplexed, and one shell script.** The app runs `/usr/bin/ssh` and
// hands it a small POSIX shell program with a verb. One operation is one round trip. The first
// command opens a master connection and the rest ride on its socket, which is what makes
// twirling through a tree feel local.
//
// **Three things a remote folder does not have, all said out loud rather than faked.** There
// is no Trash on a server, so the delete confirmation says "delete" and means it. There is no
// watcher for a machine that is not this one, so ⌘R is what replaces it. And there is no local
// location, so Open in Finder is not offered and a preview that needs a file is fetched first.

import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import * as FilePath from '../../shared/file-path.js'
import { stampsMatch } from '../../shared/file-stamp.js'
import { conflict, notFound, nameTaken, StoreError, folderUnavailable } from '../../shared/store/errors.js'
import { SOURCE, STATUS, parseEntry, parseStamp, quoted } from './remote-script.js'
import * as Keys from './ssh-keys.js'
import { target, displayName, identity } from './remote-location.js'
import { compareNodes, copyName, numberedName, splitName, isHidden } from '../../shared/store/names.js'

const SSH = '/usr/bin/ssh'

/** Paths per `stamps` round trip, well inside any server's limit on a command line's length. */
const STAMP_BATCH = 200

export class RemoteStore {
  constructor (location) {
    this.location = location
    this.kind = 'remote'
    this.absoluteRoot = ''
    this.reachable = true
    this.fetched = new Map()                // remote path → a local copy, for the viewers
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
   * Makes sure there is a key, opens the connection, and settles what the opened folder's
   * absolute path is. Every path sent afterwards is built from it, so nothing depends on where
   * a login shell happens to start and `~/notes` is resolved exactly once.
   */
  async connect () {
    await Keys.ensure()
    const answer = await this.send('hello', [this.location.path], { timeout: 25000 })
    const resolved = answer.toString('utf8').trim()
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
   * Hangs up the multiplexed connection. The socket would expire on its own, but a window
   * closed is a login that should end with it rather than linger on a machine the user has
   * finished with.
   */
  close () {
    const child = spawn(SSH, [...this.options(), '-O', 'exit', target(this.location)],
      { stdio: 'ignore' })
    child.on('error', () => {})
    for (const copy of this.fetched.values()) fs.rm(copy, { force: true }).catch(() => {})
    this.fetched.clear()
  }

  // MARK: - Listing

  async children (relative) {
    const output = await this.send('list', [this.remotePath(relative)])
    const nodes = []
    for (const line of output.toString('utf8').split('\n')) {
      if (!line) continue
      const entry = parseEntry(line)
      if (!entry) continue
      const name = path.posix.basename(entry.name)
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
    const stamp = parseStamp(output.subarray(0, newline).toString('utf8'))
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
      const stamp = parseStamp(output.toString('utf8').trim())
      if (!stamp) throw new StoreError('failed', 'The server did not report the file back.')
      return stamp
    } catch (error) {
      if (error.status === STATUS.conflict) {
        const current = parseStamp(error.output.toString('utf8').trim())
        throw conflict(current ?? { modified: Date.now(), size: -1 })
      }
      if (error.status === STATUS.notFound) throw notFound(relative)
      throw this.translate(error, relative)
    }
  }

  async stamp (relative) {
    const output = await this.send('stat', [this.remotePath(relative)])
    const stamp = parseStamp(output.toString('utf8').trim())
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
      for (const line of output.toString('utf8').split('\n')) {
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
    return FilePath.appending(parentPath, output.toString('utf8').trim())
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
    return FilePath.appending(parent, output.toString('utf8').trim())
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

  startWatching () { /* There is no FSEvents for a machine that is not this one. ⌘R is it. */ }
  stopWatching () {}

  /**
   * A copy of a remote file inside the app's own data directory, for the one viewer that can
   * only take a path. It is a copy to look at, never written back, and it goes when the window
   * does.
   */
  async fetchForViewing (relative) {
    const existing = this.fetched.get(relative)
    if (existing) return existing
    const { data } = await this.read(relative)
    const directory = path.join(os.tmpdir(), 'lotext-remote')
    await fs.mkdir(directory, { recursive: true })
    const copy = path.join(directory, `${Date.now()}-${FilePath.name(relative)}`)
    await fs.writeFile(copy, data)
    this.fetched.set(relative, copy)
    return copy
  }

  // MARK: - Running one verb

  /**
   * One verb, one round trip. A non-zero exit becomes a failure carrying the status and
   * whatever the script managed to print first — for a refused save, that is the stamp the
   * file actually has, which is exactly what the conflict prompt needs.
   */
  send (verb, args, { input = null, timeout = 30000 } = {}) {
    const command = [
      ...this.options(),
      target(this.location),
      '/bin/sh', '-c', quoted(SOURCE), 'lotext',
      quoted(verb),
      ...args.map(quoted),
    ]

    return new Promise((resolve, reject) => {
      const child = spawn(SSH, command, { stdio: ['pipe', 'pipe', 'pipe'] })
      const out = []
      const err = []
      let settled = false

      const timer = setTimeout(() => {
        settled = true
        child.kill('SIGKILL')
        this.reachable = false
        reject(new StoreError('unreachable', 'The server did not answer in time.'))
      }, timeout)

      child.stdout.on('data', (chunk) => out.push(chunk))
      child.stderr.on('data', (chunk) => err.push(chunk))
      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.reachable = false
        reject(new StoreError('unreachable', error.message))
      })
      child.on('close', (status) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const output = Buffer.concat(out)
        const diagnostic = Buffer.concat(err).toString('utf8').trim()
        if (status === 0) {
          this.reachable = true
          resolve(output)
          return
        }
        // 255 is `ssh` itself rather than the script: it never got as far as running a
        // command, so this is about the connection and the connection is now suspect.
        if (status === 255) {
          this.reachable = false
          reject(connectionError(diagnostic))
          return
        }
        const failure = new StoreError('remote', diagnostic || `The server refused (${status}).`)
        failure.status = status
        failure.output = output
        reject(failure)
      })

      if (input) child.stdin.end(input)
      else child.stdin.end()
    })
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

  /**
   * How `ssh` is invoked. Nothing here may ever ask a question at a keyboard: there is no
   * terminal behind this process and a prompt nobody can answer is a command that hangs.
   */
  options () {
    const args = [
      // Never ask anything. Fail at once, with something to show the user.
      '-o', 'BatchMode=yes',
      '-o', 'PreferredAuthentications=publickey',
      '-o', 'NumberOfPasswordPrompts=0',
      // Only the app's own key. Without this, ssh also offers whatever an agent has, and a
      // server counting failed attempts can refuse the login before the one key that would
      // work has been tried.
      '-o', 'IdentitiesOnly=yes',
      '-i', Keys.privateKey(),
      // First contact is trusted; every contact after it is checked against what was seen the
      // first time. A server whose key *changes* is refused, and the refusal is reported as
      // one rather than retried around: that is the entire value of keeping the file.
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `UserKnownHostsFile=${Keys.knownHosts()}`,
      '-o', 'ConnectTimeout=10',
      '-o', 'LogLevel=ERROR',
      // The multiplexing. `auto` means the first command opens the master and the rest join
      // it; `ControlPersist` keeps it warm through a few minutes of idleness.
      '-o', 'ControlMaster=auto',
      '-o', `ControlPath=${this.socketPath()}`,
      '-o', 'ControlPersist=180',
    ]
    if (this.location.port) args.push('-p', String(this.location.port))
    return args
  }

  /**
   * A Unix socket may not have a path longer than 104 characters, so the connection is named
   * by a short digest of itself rather than by anything readable.
   */
  socketPath () {
    return path.join(Keys.socketDirectory(), `cm-${digest(identity(this.location))}`)
  }
}

/**
 * `ssh`'s own failures, read off what it printed. The distinction worth making is only ever
 * "it would not let us in" against "we could not get there", because those are the two things
 * a user can do something about and they are different things.
 */
function connectionError (diagnostic) {
  const text = diagnostic.toLowerCase()
  if (text.includes('permission denied') || text.includes('authentication') ||
      text.includes('host key verification failed')) {
    return new StoreError('refused', diagnostic || 'The server refused the key.')
  }
  return new StoreError('unreachable', diagnostic || 'The server could not be reached.')
}

/**
 * FNV-1a, written out rather than reached for: two launches must name the same connection the
 * same socket, or the first one is left behind as litter.
 */
function digest (text) {
  let hash = 0xcbf29ce4n ^ 0n
  hash = 0x811c9dc5n
  for (const byte of Buffer.from(text, 'utf8')) {
    hash ^= BigInt(byte)
    hash = (hash * 0x01000193n) & 0xffffffffn
  }
  return hash.toString(16).padStart(8, '0')
}
