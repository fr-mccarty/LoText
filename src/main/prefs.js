// Persistence, as one JSON file in the app's own data directory. There is no database here
// and no schema: the app keeps a handful of preferences and a handful of lists, and a file it
// can read with its eyes is worth more than anything cleverer.
//
// Writes are debounced and atomic — a temporary file renamed over the real one — so a quit in
// the middle of one cannot leave half a settings file behind.

import { promises as fs, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

let cache = null
let file = null
let timer = null

function location () {
  if (!file) {
    const directory = app.getPath('userData')
    mkdirSync(directory, { recursive: true })
    file = path.join(directory, 'lotext.json')
  }
  return file
}

export function load () {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(location(), 'utf8'))
  } catch {
    cache = {}
  }
  return cache
}

export function get (key, fallback) {
  const value = load()[key]
  return value === undefined ? fallback : value
}

export function set (key, value) {
  load()[key] = value
  schedule()
}

function schedule () {
  clearTimeout(timer)
  timer = setTimeout(() => { flush() }, 200)
}

/** Called on quit as well, so the last change of a session is never the one that is lost. */
export function flush () {
  clearTimeout(timer)
  timer = null
  if (!cache) return
  const target = location()
  const temporary = `${target}.part`
  try {
    writeFileSync(temporary, JSON.stringify(cache, null, 2))
    renameSync(temporary, target)
  } catch {
    // A preferences file that cannot be written is not a reason to stop editing text.
  }
}

/** The recovery copies live beside the preferences, inside the app's own directory. */
export function dataDirectory (...parts) {
  const directory = path.join(app.getPath('userData'), ...parts)
  mkdirSync(directory, { recursive: true })
  return directory
}

export { fs }
