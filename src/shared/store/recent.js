// ⇧⌘O's list: the files under the opened folder changed most recently, by the modified date on
// disk. So an edit made anywhere — here, in another app, on the server — counts, and the list is
// the same after a relaunch.
//
// Like ⇧⌘P it walks the whole folder each time the sheet opens, for the reason in walk.js: there
// is no index to keep honest. Unlike ⇧⌘P it then needs a date per file, which the walk does not
// ask for; the store answers those in bulk — a stat each locally, one round trip per batch on a
// server.

import { walk } from './walk.js'

/** A keyboard list read by eye: twenty is plenty. */
export const RECENT_LIMIT = 20

/**
 * The `limit` most recently modified files, newest first, as [{ path, modified }] with
 * `modified` in milliseconds. A file whose date cannot be read is left out. Answers null when
 * `shouldStop` cut it short.
 */
export async function recentlyEdited (store, shouldStop, limit = RECENT_LIMIT) {
  const paths = []
  await walk(store, (batch) => paths.push(...batch.files), shouldStop)
  if (shouldStop()) return null
  const times = await store.modifiedTimes(paths)
  if (shouldStop()) return null
  return paths
    .map((path, index) => ({ path, modified: times[index] }))
    .filter((file) => file.modified != null)
    .sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path))
    .slice(0, limit)
}
