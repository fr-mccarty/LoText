// LoText's own key, and the list of keys a connection offers.
//
// A connection offers **the Mac's keys first** — the ones in `~/.ssh` that Terminal's `ssh`
// would use — so a server that already lets this Mac in lets LoText in too. LoText's own key,
// kept in the app's data directory, is offered last: it is for a server the user would rather
// give a key of its own, and the Connect to Server sheet shows its public half for that.

import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import os from 'node:os'
import { app } from 'electron'

/**
 * Where the key, the known-hosts file and the multiplexing sockets go. Directly under the
 * app's data directory rather than somewhere tidier because a Unix socket path may not exceed
 * 104 characters and that path has already spent a good deal of it.
 */
/** Beside ssh itself: `/usr/bin` on the Mac, Windows' own OpenSSH folder there. */
const SSH_KEYGEN = process.platform === 'win32'
  ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh-keygen.exe')
  : '/usr/bin/ssh-keygen'

export function directory () {
  return path.join(app.getPath('userData'), 'ssh')
}

export const privateKey = () => path.join(directory(), 'id_ed25519')
export const publicKey = () => path.join(directory(), 'id_ed25519.pub')

/**
 * Written by `ssh` itself, and kept: a server whose key changes after the first connection is
 * a server `ssh` will refuse, loudly, which is the entire value of the file. First contact is
 * trusted, because the alternative is asking a fingerprint question of someone who has no way
 * to check the answer.
 */
export const knownHosts = () => path.join(directory(), 'known_hosts')
export const socketDirectory = () => directory()

/**
 * The standard key files in `~/.ssh`, in the order `ssh` tries them, that exist here — then
 * LoText's own. ssh only falls back on the standard files when no key is named, so naming
 * LoText's would otherwise shut the Mac's own out.
 */
export function identityFiles () {
  const standard = ['id_rsa', 'id_ecdsa', 'id_ecdsa_sk', 'id_ed25519', 'id_ed25519_sk']
    .map((name) => path.join(os.homedir(), '.ssh', name))
    .filter((file) => existsSync(file))
  return [...standard, privateKey()]
}

export async function exists () {
  try { await fs.access(privateKey()); return true } catch { return false }
}

/** The public half, as the one line that goes into the server's `authorized_keys`. */
export async function publicKeyText () {
  try {
    const text = await fs.readFile(publicKey(), 'utf8')
    return text.trim() || null
  } catch {
    return null
  }
}

/**
 * Makes the key pair if there is not one yet. Idempotent, and safe to call before every
 * connection: the common case is one existence check and no work at all.
 *
 * Ed25519 because it is small, fast, and accepted by every OpenSSH since 6.5; no passphrase
 * because there is nobody to type one — a passphrase this app held for the user would be
 * security theatre with a worse failure mode.
 */
export async function ensure () {
  if (await exists()) return
  await fs.mkdir(directory(), { recursive: true, mode: 0o700 })
  // Any half-made pair from an interrupted run goes first: ssh-keygen will not overwrite, it
  // asks, and a question asked of a process with no terminal never comes back.
  await fs.rm(publicKey(), { force: true })

  const comment = `LoText on ${os.hostname()}`
  await new Promise((resolve, reject) => {
    execFile(SSH_KEYGEN, [
      '-t', 'ed25519',
      '-f', privateKey(),
      '-N', '',
      '-q',
      '-C', comment,
    ], (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message))
      else resolve()
    })
  })
}
