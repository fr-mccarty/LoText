# Why File ▸ Recently Edited… (⇧⌘O) was slow, and what fixed it

*2026-09-29.* Reported as "really slow", with a cache in iCloud suggested. Measured first.

## The measurement

The folder was `~/Desktop`, which holds `jam-dev-tools`, a link to an SMB share
(`/Volumes/jam-dev-tools`). The real `recentlyEdited()` was bundled with esbuild, `electron`
aliased to a stub, and timed under node against that folder:

| Part | Time |
|---|---|
| Walk, whole Desktop: 521 folders, 1088 files | 1.5–2.5 s |
| … of which `DayWork` (local, 22 folders) | 9 ms |
| … of which the SMB share (498 folders) | 1.4–1.9 s |
| Modified dates, 1088 stats in batches of 64 | 0.2–0.3 s cold, ~10 ms warm |

So nearly all of it was **listing folders on the share one at a time**: about 3 ms of network
round trip each, 500 times, in series. `readdir` with and without `withFileTypes` cost the same,
so it was not Node stat-ing entries behind the scenes. The dates were never the problem.

## The fix

`walk()` (`src/shared/store/walk.js`) lists up to eight folders of a level at once and takes the
answers in frontier order, so the list is the same as before. ⇧⌘O on the Desktop went from
1.5–1.9 s to 0.7–1.1 s. Width 16 or 32 gained nothing, and nor did a free-running pool with no
wait between levels (0.7 s): about 500 listings in 0.7 s is what the smbfs mount gives. ⇧⌘P uses
the same walk and got the same speed-up.

`RemoteStore` sets `listingConcurrency = 1`: each of its listings is an `ssh` of its own, and
eight at once could run into the server's `MaxSessions`. On iOS the plugin's calls run on one
queue, so there it only overlaps the bridge's round trips.

## Why not a cache in iCloud

- The time goes into reading a network share that iCloud does not hold, and whose path means
  nothing on the iPhone; a copy of its dates in iCloud would be stale the moment it was written.
- `walk.js` has no index on purpose: the watcher says *something* changed, never *what*, so an
  index can only be kept honest by re-walking.
- What is left, ~0.7 s, is the share itself. Only a list shown from memory before the walk
  finishes would beat it, at the price of a list that can be wrong and then jump.
