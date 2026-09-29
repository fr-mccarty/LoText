// Persistence on iOS: one JSON file in the app's own Application Support directory, as on the
// Mac (src/main/prefs.js), read once at launch and written back after a short pause.
//
// Not localStorage: WebKit may clear a web view's storage under pressure, and a preference that
// can vanish on its own is worse than none. The native side writes the file atomically.

import { Native } from './native.js'

const FILE = 'lotext.json'

let cache = {}
let timer = null

/** Read before anything asks for a preference; the bridge waits on it. */
export async function load () {
  try {
    const { text } = await Native.readData({ name: FILE })
    cache = text ? JSON.parse(text) : {}
  } catch {
    cache = {}
  }
}

export function get (key, fallback) {
  const value = cache[key]
  return value === undefined ? fallback : value
}

export function set (key, value) {
  cache[key] = value
  clearTimeout(timer)
  timer = setTimeout(flush, 200)
}

/** Called as the app goes to the background too, so the last change is never the one lost. */
export function flush () {
  clearTimeout(timer)
  timer = null
  return Native.writeData({ name: FILE, text: JSON.stringify(cache, null, 2) }).catch(() => {})
}
