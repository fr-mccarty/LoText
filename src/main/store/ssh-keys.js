// The key this app logs in with, and the two files that go with it.
//
// It is **LoText's own** key, kept in the app's own data directory, and not the one in
// `~/.ssh`. The app has a key of its own, shows the user the public half, and the user
// installs that half on the server the way they would for any other client — which is also
// what keeps this app from quietly borrowing an identity the user never offered it.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import os from 'node:os'
import { app } from 'electron'

/**
 * Where the key, the known-hosts file and the multiplexing sockets go. Directly under the
 * app's data directory rather than somewhere tidier because a Unix socket path may not exceed
 * 104 characters and that path has already spent a good deal of it.
 */
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
    execFile('/usr/bin/ssh-keygen', [
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
