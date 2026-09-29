// The three lists the app keeps between launches, and the one thing they have in common: none
// of them is ever the same list as another.
//
// RECENT FOLDERS   folders opened as a window's folder. Ten, newest first, one menu item each.
//                  App-wide rather than per window: which folders have been worked in is a
//                  fact about the person, not about any one window.
// RECENT SERVERS   addresses that have *answered*, written down only after a connection
//                  succeeded. Not on a menu — it belongs in the sheet where the next
//                  connection is being made, under the field it would otherwise be typed into.
// WINDOW SESSIONS  where each window was and which file was open in it. A window closed
//                  before the quit is not reopened; one open at the quit is.
//
// The tree's expansion state is a fourth, keyed by the folder it belongs to.

import path from 'node:path'
import * as prefs from './prefs.js'

const FOLDERS_KEY = 'recentFolders'
const SERVERS_KEY = 'recentServers'
const WINDOWS_KEY = 'windowSessions'
const EXPANSION_KEY = 'expansion'

/** What the stock Open Recent menu keeps: long enough to reach last week's folder. */
const MAX_FOLDERS = 10
const MAX_SERVERS = 10

// MARK: - Recent folders

export function recentFolders () {
  const list = prefs.get(FOLDERS_KEY, [])
  return Array.isArray(list) ? list : []
}

/**
 * Written down only **after** the folder has actually opened. A folder that failed to open is
 * not a folder anybody has worked in. Re-opening one moves it to the top rather than adding a
 * second entry.
 */
export function rememberFolder (entry) {
  const list = recentFolders().filter((item) => item.id !== entry.id)
  list.unshift(entry)
  prefs.set(FOLDERS_KEY, list.slice(0, MAX_FOLDERS))
}

export function forgetFolder (id) {
  prefs.set(FOLDERS_KEY, recentFolders().filter((item) => item.id !== id))
}

export function clearRecentFolders () {
  prefs.set(FOLDERS_KEY, [])
}

/**
 * Folder names collide constantly — every checkout has a `docs` — so a name that two entries
 * share is qualified by the folder above it, as `docs — website` and `docs — app`, while a
 * name nothing else on the list shares is left alone rather than padded out with a path
 * nobody needed.
 */
export function recentFolderTitles () {
  const list = recentFolders()
  const counts = new Map()
  for (const entry of list) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1)
  return list.map((entry) => {
    if (counts.get(entry.name) === 1) return { entry, title: entry.name }
    const above = entry.kind === 'remote'
      ? entry.detail
      : path.basename(path.dirname(entry.id))
    return { entry, title: above ? `${entry.name} — ${above}` : entry.name }
  })
}

// MARK: - Recent servers

export function recentServers () {
  const list = prefs.get(SERVERS_KEY, [])
  return Array.isArray(list) ? list : []
}

export function rememberServer (entry) {
  const list = recentServers().filter((item) => item.id !== entry.id)
  list.unshift(entry)
  prefs.set(SERVERS_KEY, list.slice(0, MAX_SERVERS))
}

// MARK: - Window sessions

export function windowSessions () {
  const list = prefs.get(WINDOWS_KEY, [])
  return Array.isArray(list) ? list : []
}

export function saveWindowSessions (sessions) {
  prefs.set(WINDOWS_KEY, sessions)
}

// MARK: - Expansion

/**
 * Which folders are twirled open, per opened folder. Kept on this machine and nowhere else:
 * it is keyed by a root that means nothing anywhere but here.
 */
export function expansion (folderKey) {
  const all = prefs.get(EXPANSION_KEY, {})
  const list = all?.[folderKey]
  return Array.isArray(list) ? list : []
}

export function saveExpansion (folderKey, paths) {
  const all = { ...(prefs.get(EXPANSION_KEY, {}) ?? {}) }
  if (paths.length) all[folderKey] = paths
  else delete all[folderKey]
  prefs.set(EXPANSION_KEY, all)
}
