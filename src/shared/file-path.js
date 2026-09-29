// A path relative to the folder the user opened, so a node's identity survives the root
// folder itself being moved or renamed. The file store is the only thing that resolves one
// against a real location on disk.
//
// A FilePath is carried as its raw string — "notes/today.md", "" for the root — because it
// crosses an IPC boundary constantly and a string survives structured cloning unchanged.
// Everything below reads and writes that string.

/** Sanitized components: no empties, no `.`, no `..` — a relative path can never climb out. */
export function components (path) {
  return String(path ?? '').split('/').filter((part) => part && part !== '.' && part !== '..')
}

/** The canonical spelling of a path, with every component sanitized. */
export function normalize (path) {
  return components(path).join('/')
}

export const ROOT = ''

export function isRoot (path) {
  return normalize(path) === ''
}

/** Last component; "" at the root. */
export function name (path) {
  const parts = components(path)
  return parts.length ? parts[parts.length - 1] : ''
}

/** Null at the root. */
export function parent (path) {
  const parts = components(path)
  if (!parts.length) return null
  return parts.slice(0, -1).join('/')
}

export function appending (path, child) {
  return components(path).concat(components(child)).join('/')
}

export function depth (path) {
  return components(path).length
}

/** Whether `path` sits anywhere beneath `ancestor`. A path is not its own descendant. */
export function isDescendant (path, ancestor) {
  if (isRoot(ancestor)) return !isRoot(path)
  const a = components(ancestor)
  const b = components(path)
  if (b.length <= a.length) return false
  return a.every((part, index) => part === b[index])
}

/** `path` with `from` swapped for `to` at its head — how a rename or a move follows a file. */
export function rewriting (path, from, to) {
  if (path === from) return to
  if (!isDescendant(path, from)) return null
  const tail = components(path).slice(components(from).length)
  return components(to).concat(tail).join('/')
}
