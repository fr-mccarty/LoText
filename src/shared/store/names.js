// How the stores name things: which entries are hidden, how a copy or a moved file is renamed
// when its own name is taken, and the sidebar's ordering. Every store uses these — on this
// machine, over SSH, and on iOS — so a name comes out the same whichever one made it.

import * as FilePath from '../file-path.js'

/**
 * A name starting with `.` is hidden: `.DS_Store`, `.git`, and most of what a sync engine leaves
 * behind — including the `.icloud` placeholder a dataless file is listed under.
 */
export function isHidden (name) {
  return name.startsWith('.')
}

/**
 * Whether listings show hidden names: View ▸ Show Hidden Files, off by default. It is one switch
 * for the whole app, so it lives here, set by whoever holds the settings (`src/main/main.js`,
 * `src/mobile/bridge.js`), and every store, the walk and Recently Edited follow it.
 */
let hiddenShown = false

export function setHiddenFilesShown (shown) {
  hiddenShown = Boolean(shown)
}

/**
 * Whether a listing includes `name`. A hidden name is listed only while hidden files are shown,
 * and an `.icloud` placeholder never is: it stands for a file listed under its own name.
 */
export function isListed (name) {
  if (!isHidden(name)) return true
  if (name === '.' || name === '..') return false
  return hiddenShown && !/^\..+\.icloud$/.test(name)
}

/** `notes.md` → `{ stem: 'notes', extension: '.md' }`; a dotfile has no extension. */
export function splitName (name) {
  const body = name.startsWith('.') ? name.slice(1) : name
  const dot = body.lastIndexOf('.')
  if (dot <= 0) return { stem: name, extension: '' }
  const offset = name.length - body.length
  return { stem: name.slice(0, offset + dot), extension: name.slice(offset + dot) }
}

/** `validation.md`, 2 → `validation-2.md`: the name a move takes when its own is in use. */
export function numberedName (name, counter) {
  const { stem, extension } = splitName(name)
  return `${stem}-${counter}${extension}`
}

/** `notes.md` → `notes copy.md`, with the extension left where it is. */
export function copyName (name) {
  const { stem, extension } = splitName(name)
  return `${stem} copy${extension}`
}

/** Folders first, then by name, case-insensitively — the sidebar's whole ordering. */
export function compareNodes (a, b) {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  return FilePath.name(a.path).localeCompare(FilePath.name(b.path), undefined, { sensitivity: 'base' })
}
