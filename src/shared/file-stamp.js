// Modification date **and** byte size together. This is the unit of "has this changed?"
// everywhere in the app; nothing anywhere compares dates alone.
//
// Sync engines write files with preserved or backdated timestamps, so a date-only
// comparison misses the change entirely — which is the case the watcher exists to catch.

/** @returns {{modified:number,size:number}} — modified in milliseconds since the epoch. */
export function makeStamp (modified, size) {
  return { modified: Math.round(modified), size }
}

export function stampsMatch (a, b) {
  if (!a || !b) return false
  // Whole seconds: a folder on a server reports mtimes in seconds, and a stamp is only ever
  // compared against another stamp from the same place.
  return Math.floor(a.modified / 1000) === Math.floor(b.modified / 1000) && a.size === b.size
}
