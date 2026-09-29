// A full walk of the opened folder, which is the one thing the sidebar deliberately never
// does. The sidebar reads a directory when it is twirled open and not before; search cannot
// work that way, because a file the user has never twirled down to is exactly the file ⇧⌘P
// exists to find.
//
// **There is no index, ever**, and the watcher is the reason. It reports that *something*
// under the folder changed and never *what*, so a cached index could only be kept honest by
// re-walking the whole tree on every burst of changes, all day, for a sheet that may never be
// opened. A walk per opening costs nothing until the key is pressed and cannot be stale.
//
// **Nothing here reads a file.** Each listing is asked for the name and for whether the entry
// is a directory, and for nothing else — not size, not dates, and certainly not contents. A
// dataless synced file is therefore listed without being faulted down.

import * as FilePath from '../file-path.js'
import { openability } from '../binary-types.js'

/**
 * Twenty thousand names is a much larger project than this app is for. A folder that exceeds
 * it is a home directory somebody opened by accident, and the honest answer there is a
 * truncated list *that says so* rather than a spinner that never ends.
 */
export const MAX_FILES = 20_000
/**
 * The second half of the link guard: the visited set catches a link that points back up its
 * own tree, and this catches the pathological case that check cannot see.
 */
export const MAX_DEPTH = 24

/**
 * Breadth-first, a level at a time, because the shallow files are the ones most likely to be
 * wanted and this way they are matchable before the deep ones have been listed.
 *
 * `onBatch` is handed each level as it lands, so the sheet fills in rather than appearing all
 * at once at the end. `shouldStop` is asked between levels: closing the sheet cancels the walk.
 */
export async function walk (store, onBatch, shouldStop) {
  let frontier = [FilePath.ROOT]
  let total = 0
  let truncated = false
  const visited = new Set()

  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth += 1) {
    const next = []
    const files = []

    for (const folder of frontier) {
      if (shouldStop()) return
      let children
      try {
        children = await store.children(folder)
      } catch {
        continue                              // a folder that cannot be read is simply skipped
      }
      for (const node of children) {
        if (node.kind === 'folder') {
          // A folder already descended into is not descended into twice, which is what ends a
          // link pointing back up its own tree.
          const key = node.leavesTheFolder ? `link:${node.path}` : node.path
          if (visited.has(key)) continue
          visited.add(key)
          next.push(node.path)
          continue
        }
        // A result is a file that can be **opened**: folders are left out, having nowhere to
        // open to, and so are the opaque binaries the tree dims. A previewable file stays in —
        // it opens perfectly well, in a viewer.
        if (openability(FilePath.name(node.path), false) === 'opaque') continue
        if (total >= MAX_FILES) { truncated = true; break }
        files.push(node.path)
        total += 1
      }
      if (truncated) break
    }

    if (files.length || truncated) onBatch({ files, truncated, total })
    if (truncated) return
    frontier = next
  }
}
