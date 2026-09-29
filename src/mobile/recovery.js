// WORKING SAVE on iOS — the same copy-a-crash-can't-take as src/main/recovery.js, kept in the
// app's own data directory and never beside the user's file. The rules are the Mac's: written
// after a pause in typing and when a save fails, thrown away when a save succeeds, and offered
// back — never silently — when the file next opens.

import { Native } from './native.js'

/** A name for the copy that is stable for one file in one folder, and safe as a file name. */
function nameFor (folderKey, filePath) {
  const source = `${folderKey}\u0000${filePath}`
  // FNV-1a, twice over with different seeds: a file name, not a secret.
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x5bd1e995
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0
  }
  return `recovery/${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}.json`
}

export async function write (folderKey, filePath, text) {
  const payload = JSON.stringify({ folderKey, path: filePath, text, at: Date.now() })
  // A recovery copy that cannot be written is not a reason to stop editing.
  await Native.writeData({ name: nameFor(folderKey, filePath), text: payload }).catch(() => {})
}

/** Null when there is nothing waiting, or when what is waiting says the same as the file. */
export async function read (folderKey, filePath, diskText) {
  try {
    const { text } = await Native.readData({ name: nameFor(folderKey, filePath) })
    if (!text) return null
    const payload = JSON.parse(text)
    if (typeof payload?.text !== 'string') return null
    if (payload.text === diskText) { await discard(folderKey, filePath); return null }
    return { text: payload.text, at: payload.at ?? 0 }
  } catch {
    return null
  }
}

export async function discard (folderKey, filePath) {
  await Native.removeData({ name: nameFor(folderKey, filePath) }).catch(() => {})
}
