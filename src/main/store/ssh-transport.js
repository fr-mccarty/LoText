// How a remote folder's commands reach the server on the Mac: `/usr/bin/ssh`, the Mac's own.
//
// The transport half of `src/shared/store/remote-store.js`. It reads `~/.ssh/config`, offers
// the Mac's own keys before LoText's, and multiplexes: the first command opens a master
// connection and the rest ride on its socket, which is what makes twirling through a tree feel
// local.

import { spawn } from 'node:child_process'
import path from 'node:path'
import { StoreError } from '../../shared/store/errors.js'
import { target, identity } from '../../shared/store/remote-location.js'
import * as Keys from './ssh-keys.js'

const isWindows = process.platform === 'win32'

/**
 * Windows 10 and 11 carry OpenSSH as an optional feature, installed by default, at the same place
 * on every machine. Its ssh cannot multiplex — ControlMaster needs Unix sockets — so there every
 * command opens its own connection, which is slower through a tree but otherwise the same.
 */
export const SSH = isWindows
  ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe')
  : '/usr/bin/ssh'

export const sshTransport = {
  prepare: () => Keys.ensure(),

  /** Exit 255 is ssh's own failure, and is handed back as a status for the store to read. */
  run ({ location, command, input, timeout }) {
    return new Promise((resolve, reject) => {
      const child = spawn(SSH, [...options(location), target(location), command],
        { stdio: ['pipe', 'pipe', 'pipe'] })
      const out = []
      const err = []
      let settled = false

      const timer = setTimeout(() => {
        settled = true
        child.kill('SIGKILL')
        reject(new StoreError('unreachable', 'The server did not answer in time.'))
      }, timeout)

      child.stdout.on('data', (chunk) => out.push(chunk))
      child.stderr.on('data', (chunk) => err.push(chunk))
      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new StoreError('unreachable', error.message))
      })
      child.on('close', (status) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({
          status,
          output: new Uint8Array(Buffer.concat(out)),
          diagnostic: Buffer.concat(err).toString('utf8').trim(),
        })
      })

      if (input) child.stdin.end(input)
      else child.stdin.end()
    })
  },

  close (location) {
    if (isWindows) return                    // nothing was kept open to close
    const child = spawn(SSH, [...options(location), '-O', 'exit', target(location)], { stdio: 'ignore' })
    child.on('error', () => {})
  },
}

/**
 * How `ssh` is invoked. Nothing here may ever ask a question at a keyboard: there is no
 * terminal behind this process and a prompt nobody can answer is a command that hangs.
 */
function options (location) {
  const args = [
    // Never ask anything. Fail at once, with something to show the user.
    '-o', 'BatchMode=yes',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'NumberOfPasswordPrompts=0',
    // The Mac's own keys first — the agent's, whatever `~/.ssh/config` names, then the
    // standard files in `~/.ssh` — and LoText's key last, for a server that was given that
    // one instead. The standard files are named here because ssh tries them only when no
    // key is named at all, and LoText's is.
    ...Keys.identityFiles().flatMap((file) => ['-i', file]),
    // First contact is trusted; every contact after it is checked against what was seen the
    // first time. A server whose key *changes* is refused, and the refusal is reported as
    // one rather than retried around: that is the entire value of keeping the file. The
    // Mac's own list is read first and written to, so a server already known in Terminal is
    // known here; LoText's own list is still read, for the servers trusted before.
    '-o', 'StrictHostKeyChecking=accept-new',
    // Quoted: LoText's paths sit under `Application Support`, and an `-o` value is read like
    // a config line, so an unquoted space ends it.
    '-o', `UserKnownHostsFile=~/.ssh/known_hosts "${forSsh(Keys.knownHosts())}"`,
    '-o', 'ConnectTimeout=10',
    '-o', 'LogLevel=ERROR',
  ]
  // The multiplexing. `auto` means the first command opens the master and the rest join
  // it; `ControlPersist` keeps it warm through a few minutes of idleness.
  if (!isWindows) {
    args.push(
      '-o', 'ControlMaster=auto',
      '-o', `ControlPath="${socketPath(location)}"`,
      '-o', 'ControlPersist=180',
    )
  }
  if (location.port) args.push('-p', String(location.port))
  return args
}

/**
 * A path as an `-o` value: ssh reads it like a config line, where a backslash can escape what
 * follows it, and Windows' OpenSSH takes forward slashes as readily as its own.
 */
function forSsh (file) {
  return isWindows ? file.replaceAll('\\', '/') : file
}

/**
 * A Unix socket may not have a path longer than 104 characters, so the connection is named
 * by a short digest of itself rather than by anything readable.
 */
function socketPath (location) {
  return path.join(Keys.socketDirectory(), `cm-${digest(identity(location))}`)
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
