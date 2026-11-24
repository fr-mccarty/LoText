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
 * How many folders of a level are listed at once, unless the store says otherwise
 * (`store.listingConcurrency`). A listing is mostly waiting — on a network share each one is a
 * round trip of a few milliseconds — so one at a time spent ⇧⌘O's two seconds on a Desktop with
 * a 500-folder SMB share linked in. Eight at once took
 * it under one; more gained nothing.
 */
export const LISTING_CONCURRENCY = 8

/**
 * Breadth-first, a level at a time, because the shallow files are the ones most likely to be
 * wanted and this way they are matchable before the deep ones have been listed.
 *
 * `onBatch` is handed each level as it lands, so the sheet fills in rather than appearing all
 * at once at the end. `shouldStop` is asked between listings: closing the sheet cancels the walk.
 */
export async function walk (store, onBatch, shouldStop) {
  let frontier = [FilePath.ROOT]
  let total = 0
  let truncated = false
  const visited = new Set()

  const width = store.listingConcurrency ?? LISTING_CONCURRENCY

  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth += 1) {
    const next = []
    const files = []

    for (let start = 0; start < frontier.length && !truncated; start += width) {
      if (shouldStop()) return
      // Listed together, taken in frontier order, so the result is the same as one at a time.
      const listings = await Promise.all(frontier.slice(start, start + width).map((folder) =>
        store.children(folder).catch(() => null)))   // a folder that cannot be read is simply skipped
      for (const children of listings) {
        for (const node of children ?? []) {
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
    }

    if (files.length || truncated) onBatch({ files, truncated, total })
    if (truncated) return
    frontier = next
  }
}
