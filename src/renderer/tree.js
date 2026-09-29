// FILE TREE — the sidebar's model.
//
//   holds:  the rows it has loaded so far
//           which folders are twirled open        (remembered between launches)
//           which row is highlighted
//
//   does:   load a folder's contents the first time you twirl it open, not before
//           refresh itself in place — twirled-open folders stay open, scroll stays put
//           reveal a file: expand whatever folders are hiding it
//
// Children load lazily on first expansion, and a collapsed folder is never read. Opening a
// folder of fifty thousand files costs exactly one listing.

import * as FilePath from '../shared/file-path.js'

// A listing arrives as paths; the rows are drawn, renamed and spoken about by name, so the
// name is attached once here rather than recomputed at every row.
const named = (nodes) => nodes.map((node) => ({ ...node, name: FilePath.name(node.path) }))

export class FileTree {
  constructor (bridge, { onChange }) {
    this.bridge = bridge
    this.onChange = onChange
    this.children = new Map()                 // folder path → nodes
    this.expanded = new Set()
    this.renamingPath = null
    this.loading = new Set()
  }

  reset (expansion = []) {
    this.children.clear()
    this.expanded = new Set(expansion)
    this.renamingPath = null
    this.loading.clear()
  }

  nodeAt (path) {
    const parent = FilePath.parent(path)
    if (parent === null) return null
    return (this.children.get(parent) ?? []).find((node) => node.path === path) ?? null
  }

  isFolderLink (path) {
    const node = this.nodeAt(path)
    return Boolean(node?.isLink && node.leavesTheFolder && node.kind === 'folder')
  }

  // MARK: - Loading

  async load (path) {
    if (this.loading.has(path)) return
    this.loading.add(path)
    try {
      this.children.set(path, named(await this.bridge.children(path)))
    } catch {
      // A folder that cannot be read lists as empty rather than as an error in the tree: the
      // banner above the tree is where "this folder is unavailable" is said.
      this.children.set(path, [])
    } finally {
      this.loading.delete(path)
    }
    this.onChange?.()
  }

  async ensureLoaded (path) {
    if (!this.children.has(path)) await this.load(path)
  }

  /** Re-lists every folder that is currently twirled open, in place. */
  async refresh () {
    const folders = [FilePath.ROOT, ...this.expanded].filter((path, index, all) =>
      all.indexOf(path) === index)
    await Promise.all(folders.map(async (folder) => {
      try {
        this.children.set(folder, named(await this.bridge.children(folder)))
      } catch {
        this.children.delete(folder)
      }
    }))
    // A folder that has gone is no longer twirled open.
    for (const path of [...this.expanded]) {
      if (!FilePath.isRoot(path) && !this.nodeAt(path)) this.expanded.delete(path)
    }
    this.onChange?.()
  }

  // MARK: - Twirling

  async expand (path) {
    if (FilePath.isRoot(path)) return
    this.expanded.add(path)
    await this.ensureLoaded(path)
    this.persist()
    this.onChange?.()
  }

  collapse (path) {
    this.expanded.delete(path)
    this.persist()
    this.onChange?.()
  }

  async toggle (path) {
    if (this.expanded.has(path)) this.collapse(path)
    else await this.expand(path)
  }

  /** Opens whatever folders are hiding `path`, so the row exists to be scrolled to. */
  async expandChain (path) {
    const parts = FilePath.components(path)
    let current = FilePath.ROOT
    for (let index = 0; index < parts.length - 1; index += 1) {
      current = FilePath.appending(current, parts[index])
      this.expanded.add(current)
      await this.ensureLoaded(current)
    }
    this.persist()
    this.onChange?.()
  }

  persist () {
    this.bridge.saveExpansion([...this.expanded]).catch(() => {})
  }

  // MARK: - Rows

  /**
   * The outline flattened to the rows that are actually visible, so a collapsed folder costs
   * nothing to draw and nothing to have read.
   */
  visibleRows () {
    const rows = []
    const walk = (folder, depth) => {
      for (const node of this.children.get(folder) ?? []) {
        rows.push({ node, depth })
        if (node.kind === 'folder' && this.expanded.has(node.path)) walk(node.path, depth + 1)
      }
    }
    walk(FilePath.ROOT, 0)
    return rows
  }

  beginRename (path) {
    this.renamingPath = path
    this.onChange?.()
  }

  cancelRename () {
    this.renamingPath = null
    this.onChange?.()
  }
}
