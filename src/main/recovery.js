// WORKING SAVE — a copy a crash can't take.
//
// Saving still happens on exactly three occasions. This is not a fourth: it writes a copy of
// unsaved text into the app's **own** directory, never next to the user's file, never in the
// opened folder, and never at a path the user gave it. A file read and saved untouched is
// still byte-for-byte the same file.
//
//   while the buffer is dirty, after a two-second pause in typing → write the copy
//   a real save succeeds                → throw the copy away, there is nothing left to protect
//   a save cannot go through            → write the copy at once, that is when it matters
//
// Next launch, the file opens and a copy is waiting that says something different: **ask**.
// Never silently — silently replacing a file's text with a buffer from a previous life is the
// thing this exists to prevent. Restoring leaves the buffer dirty; recovering is not saving.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import * as prefs from './prefs.js'

function directory () {
  return prefs.dataDirectory('recovery')
}

function fileFor (folderKey, filePath) {
  const key = createHash('sha256').update(`${folderKey}\u0000${filePath}`).digest('hex').slice(0, 32)
  return path.join(directory(), `${key}.json`)
}

export async function write (folderKey, filePath, text) {
  const payload = JSON.stringify({ folderKey, path: filePath, text, at: Date.now() })
  const target = fileFor(folderKey, filePath)
  try {
    await fs.writeFile(`${target}.part`, payload, 'utf8')
    await fs.rename(`${target}.part`, target)
  } catch {
    // A recovery copy that cannot be written is not a reason to stop editing.
  }
}

/** Null when there is nothing waiting, or when what is waiting says the same as the file. */
export async function read (folderKey, filePath, diskText) {
  try {
    const raw = await fs.readFile(fileFor(folderKey, filePath), 'utf8')
    const payload = JSON.parse(raw)
    if (typeof payload?.text !== 'string') return null
    if (payload.text === diskText) { await discard(folderKey, filePath); return null }
    return { text: payload.text, at: payload.at ?? 0 }
  } catch {
    return null
  }
}

export async function discard (folderKey, filePath) {
  await fs.rm(fileFor(folderKey, filePath), { force: true }).catch(() => {})
}
