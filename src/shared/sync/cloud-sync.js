// Settings, reading positions and saved servers over iCloud: optional, off until the user turns it on, and the
// same code on the Mac (main process) and on iOS (the web view). `specs/icloud-sync.md` is the
// design; this is the part both platforms run.
//
// THE FOLDER    One folder in the app's iCloud container, reached through a small adapter —
//               `{ available, list, read, write }` — because the Mac writes the container's
//               directory with `fs` and iOS goes through the native side's file coordination.
// ONE FILE EACH Every device writes its own `<deviceID>.json` and only reads the others'. A file
//               with one writer can never be in conflict, so iCloud never makes the "conflicted
//               copy" a shared settings file would.
// THE MERGE     Per key, the newest change wins: each synced value carries the time it was set.
//               Settings sync as the editor's keys one by one and the print presets as one unit
//               (a list cannot be merged by key without becoming a database). A position is one
//               key per document; a saved server, one entry per address.
//
// Local-first: the settings store stays the source of truth and nothing asks this module for a
// setting. A local change is found by diffing against `cloud.mirror`, the values last seen; a
// value arriving from another device is written through the settings store, so its clamps run,
// and recorded in the mirror first, so it is not mistaken for a local change and sent back.

import { DEFAULT_VIEW } from '../settings-shape.js'

const ENABLED_KEY = 'cloud.enabled'
const DEVICE_KEY = 'cloud.deviceID'
const STAMPS_KEY = 'cloud.stamps'
const MIRROR_KEY = 'cloud.mirror'
/** False from turning it on until the first time iCloud answers: the first merge is a joining. */
const JOINED_KEY = 'cloud.joined'
const POSITIONS_KEY = 'positions'
const SERVERS_KEY = 'recentServers'

const FORMAT = 'lotext.sync'
const VERSION = 1

/** The editor's settings, key by key — an allowlist, so a key added later does not sync by accident. */
export const VIEW_SYNC_KEYS = Object.keys(DEFAULT_VIEW).map((key) => `view.${key}`)
const PRINT_KEY = 'print'
export const SYNC_KEYS = [...VIEW_SYNC_KEYS, PRINT_KEY]

/** Positions kept on this device, and how many of the iCloud ones go into its sync file. */
const MAX_LOCAL_POSITIONS = 1000
const MAX_SYNCED_POSITIONS = 500

/** Connect to Server's list: the servers that answered, newest first. */
const MAX_SERVERS = 10

const WRITE_DELAY = 1000

/**
 * `prefs` is the platform's `{ get, set, flush }`; `settings` the shared settings store; `folder`
 * the iCloud adapter. `onStatus` hears every change of status, for the settings panel.
 */
export function createCloudSync ({ prefs, settings, folder, deviceName, newID, now = Date.now, onStatus }) {
  let applying = false
  let timer = null
  let queue = Promise.resolve()
  /**
   * What this device last wrote. A write sets off the folder watchers on every device, this one
   * included, and each of those is a refresh that ends in a write — so a file that would say the
   * same again is not written, and the loop ends there.
   */
  let lastWritten = null
  let status = { state: 'off', devices: [], lastSynced: null, message: null }

  const enabled = () => prefs.get(ENABLED_KEY, false) === true

  function deviceID () {
    let id = prefs.get(DEVICE_KEY, null)
    if (!id) { id = newID(); prefs.set(DEVICE_KEY, id) }
    return id
  }

  /** One thing at a time: a refresh and a write never interleave their reads of the prefs. */
  function serially (task) {
    queue = queue.then(task, task)
    return queue
  }

  function setStatus (patch) {
    status = { ...status, ...patch }
    onStatus?.(publicStatus())
  }

  function publicStatus () {
    return { enabled: enabled(), ...status }
  }

  // MARK: - Local values

  /** The current value of every synced key, read out of the settings store. */
  function currentValues () {
    const state = settings.read()
    const values = {}
    for (const key of VIEW_SYNC_KEYS) values[key] = state.view[key.slice(5)]
    values[PRINT_KEY] = { presets: state.presets, activePresetID: state.activePresetID }
    return values
  }

  const stamps = () => ({ ...(prefs.get(STAMPS_KEY, {}) ?? {}) })
  const mirror = () => ({ ...(prefs.get(MIRROR_KEY, {}) ?? {}) })

  /** A setting moved here: stamp whatever differs from the mirror, and schedule a write. */
  function settingsChanged () {
    if (applying || !enabled()) return
    const values = currentValues()
    const known = mirror()
    const stamped = stamps()
    let changed = false
    for (const key of SYNC_KEYS) {
      if (same(values[key], known[key])) continue
      known[key] = values[key]
      stamped[key] = now()
      changed = true
    }
    if (!changed) return
    prefs.set(MIRROR_KEY, known)
    prefs.set(STAMPS_KEY, stamped)
    scheduleWrite()
  }

  settings.onChange(settingsChanged)

  // MARK: - Positions

  function positions () {
    const all = prefs.get(POSITIONS_KEY, {})
    return all && typeof all === 'object' ? all : {}
  }

  function position (key) {
    if (!key) return null
    const found = positions()[key]
    return found ? { anchor: found.anchor, head: found.head, top: found.top } : null
  }

  /**
   * Kept on this device whether or not iCloud is on; a key under iCloud Drive (`icloud:…`) is
   * also written to this device's sync file when it is.
   */
  function rememberPosition (key, value) {
    if (!key || !value) return
    const entry = {
      anchor: Math.max(0, Math.trunc(Number(value.anchor) || 0)),
      head: Math.max(0, Math.trunc(Number(value.head) || 0)),
      top: Math.max(0, Math.trunc(Number(value.top) || 0)),
    }
    const all = positions()
    const old = all[key]
    if (old && old.anchor === entry.anchor && old.head === entry.head && old.top === entry.top) return
    prefs.set(POSITIONS_KEY, capped({ ...all, [key]: { ...entry, at: now() } }, MAX_LOCAL_POSITIONS))
    if (enabled() && isCloudKey(key)) scheduleWrite()
  }

  // MARK: - Saved servers

  /**
   * Connect to Server's list. An address is written down only after a connection to it has
   * succeeded, so the list is places that have answered. Kept on this device whether or not
   * iCloud is on, and with it on, a server saved on the Mac is listed on the iPhone too — each
   * device still needs its own key on the server, so a listed server is a place to go, not a
   * way in.
   */
  function servers () {
    const list = prefs.get(SERVERS_KEY, [])
    return Array.isArray(list) ? list : []
  }

  function rememberServer (entry) {
    if (!entry?.id) return
    const list = servers().filter((item) => item.id !== entry.id)
    list.unshift({ ...entry, at: now() })
    prefs.set(SERVERS_KEY, list.slice(0, MAX_SERVERS))
    if (enabled()) scheduleWrite()
  }

  // MARK: - Turning it on and off

  /**
   * On: the account's settings win over this device's — a device joining takes what is already
   * there — and anything the account has not heard of is published from here.
   */
  async function setEnabled (on) {
    if (on === enabled()) return publicStatus()
    prefs.set(ENABLED_KEY, on)
    if (!on) {
      clearTimeout(timer)
      setStatus({ state: 'off', devices: [], message: null })
      prefs.flush()
      return publicStatus()
    }
    prefs.set(STAMPS_KEY, {})
    prefs.set(MIRROR_KEY, currentValues())
    prefs.set(JOINED_KEY, false)
    await refresh()
    return publicStatus()
  }

  // MARK: - Reading the other devices

  /** At launch, whenever the app comes forward, and whenever the folder says something changed. */
  function refresh () {
    return serially(async () => {
      if (!enabled()) { setStatus({ state: 'off' }); return }
      let available
      try {
        available = await folder.available()
      } catch {
        available = false
      }
      if (!available) {
        setStatus({ state: 'unavailable', message: folder.unavailableMessage?.() ?? null })
        return
      }
      let others
      try {
        others = await readOthers()
      } catch (error) {
        setStatus({ state: 'failed', message: error?.message ?? String(error) })
        return
      }
      merge(others)
      if (prefs.get(JOINED_KEY, true) === false) {
        stampTheUnstamped()
        prefs.set(JOINED_KEY, true)
      }
      await write()
      setStatus({
        state: 'on',
        message: null,
        devices: others.map((file) => file.device).filter(Boolean),
        lastSynced: new Date(now()).toISOString(),
      })
    })
  }

  async function readOthers () {
    const own = `${deviceID()}.json`
    const names = (await folder.list()).filter((name) => name.endsWith('.json') && name !== own)
    const files = []
    for (const name of names) {
      let text
      try {
        text = await folder.read(name)
      } catch {
        continue                              // one unreadable device is not a failed sync
      }
      const file = parse(text)
      if (file) files.push(file)
    }
    return files
  }

  /** Every other device's values into this one's, newest per key. */
  function merge (others) {
    const stamped = stamps()
    const known = mirror()
    const adopted = {}
    for (const file of others) {
      for (const key of SYNC_KEYS) {
        const incoming = file.settings?.[key]
        if (!incoming || !(Number(incoming.at) > (stamped[key] ?? 0))) continue
        const newest = adopted[key]
        if (newest && newest.at >= incoming.at) continue
        adopted[key] = { value: incoming.value, at: Number(incoming.at) }
      }
    }

    const keys = Object.keys(adopted)
    if (keys.length) {
      const view = {}
      let print = null
      for (const key of keys) {
        if (key === PRINT_KEY) print = adopted[key].value
        else view[key.slice(5)] = adopted[key].value
        stamped[key] = adopted[key].at
      }
      applying = true
      try {
        settings.applySynced({ view: Object.keys(view).length ? view : null, print })
      } finally {
        applying = false
      }
      // What the store kept, which its clamps may have changed, is what the mirror remembers;
      // the stamp stays the other device's, so neither side sees a change to send back.
      const values = currentValues()
      for (const key of keys) known[key] = values[key]
      prefs.set(STAMPS_KEY, stamped)
      prefs.set(MIRROR_KEY, known)
    }

    const all = positions()
    let moved = false
    for (const file of others) {
      for (const [key, entry] of Object.entries(file.positions ?? {})) {
        if (!isCloudKey(key) || !entry || !(Number(entry.at) > (all[key]?.at ?? 0))) continue
        all[key] = {
          anchor: Number(entry.anchor) || 0,
          head: Number(entry.head) || 0,
          top: Number(entry.top) || 0,
          at: Number(entry.at),
        }
        moved = true
      }
    }
    if (moved) prefs.set(POSITIONS_KEY, capped(all, MAX_LOCAL_POSITIONS))

    const saved = new Map(servers().map((entry) => [entry.id, entry]))
    let added = false
    for (const file of others) {
      for (const entry of Array.isArray(file.servers) ? file.servers : []) {
        if (!entry?.id || typeof entry.address !== 'string' || !entry.location?.host) continue
        if (!(Number(entry.at) > (saved.get(entry.id)?.at ?? 0))) continue
        saved.set(entry.id, { id: entry.id, address: entry.address, location: entry.location, at: Number(entry.at) })
        added = true
      }
    }
    if (added) {
      const list = [...saved.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      prefs.set(SERVERS_KEY, list.slice(0, MAX_SERVERS))
    }
  }

  /** After joining, what nobody else had set is this device's to publish. */
  function stampTheUnstamped () {
    const stamped = stamps()
    for (const key of SYNC_KEYS) if (!stamped[key]) stamped[key] = now()
    prefs.set(STAMPS_KEY, stamped)
    prefs.set(MIRROR_KEY, currentValues())
  }

  // MARK: - Writing this device's file

  function scheduleWrite () {
    clearTimeout(timer)
    timer = setTimeout(() => { flush() }, WRITE_DELAY)
  }

  /** Called as the app quits or goes to the background, so the last change is written. */
  function flush () {
    clearTimeout(timer)
    timer = null
    if (!enabled()) return Promise.resolve()
    return serially(async () => {
      if (!await folder.available().catch(() => false)) return
      await write()
    })
  }

  async function write () {
    const stamped = stamps()
    const values = currentValues()
    const synced = {}
    for (const key of SYNC_KEYS) {
      if (stamped[key]) synced[key] = { value: values[key], at: stamped[key] }
    }
    const cloudPositions = Object.fromEntries(
      Object.entries(positions()).filter(([key]) => isCloudKey(key)))
    const file = {
      format: FORMAT,
      version: VERSION,
      device: deviceName,
      settings: synced,
      positions: capped(cloudPositions, MAX_SYNCED_POSITIONS),
      servers: servers().map(({ id, address, location, at }) => ({ id, address, location, at: at ?? 0 })),
    }
    const text = JSON.stringify(file, null, 2) + '\n'
    if (text === lastWritten) return
    try {
      await folder.write(`${deviceID()}.json`, text)
      lastWritten = text
    } catch (error) {
      setStatus({ state: 'failed', message: error?.message ?? String(error) })
    }
  }

  return {
    status: publicStatus,
    setEnabled,
    refresh,
    flush,
    position,
    rememberPosition,
    servers,
    rememberServer,
    isEnabled: enabled,
    /** A write is waiting: the Mac holds the quit for it. */
    pending: () => timer !== null,
  }
}

// MARK: - Helpers

/**
 * The keys a position is synced under: a document somewhere in iCloud Drive, or one on a
 * server, whose name (`ssh://user@host/path` and the file) is the same from every device.
 */
export function isCloudKey (key) {
  return typeof key === 'string' && (key.startsWith('icloud:') || key.startsWith('ssh:'))
}

const MOBILE_DOCUMENTS = '/Mobile Documents/'

/**
 * A document's name for its position, the same on every device when it is in iCloud: the path
 * below `Mobile Documents/`, which is where iCloud Drive lives on the Mac and on iOS alike
 * (`com~apple~CloudDocs/Notes/a.md`). Anywhere else it is this device's own path.
 */
export function positionKey (absolutePath) {
  if (!absolutePath) return null
  const at = absolutePath.indexOf(MOBILE_DOCUMENTS)
  if (at >= 0) return `icloud:${absolutePath.slice(at + MOBILE_DOCUMENTS.length).normalize('NFC')}`
  return `local:${absolutePath}`
}

function parse (text) {
  if (!text) return null
  try {
    const data = JSON.parse(text)
    if (data?.format !== FORMAT || Number(data.version) > VERSION) return null
    return data
  } catch {
    return null
  }
}

/** The newest `limit` entries by their `at`. */
function capped (entries, limit) {
  const list = Object.entries(entries)
  if (list.length <= limit) return entries
  list.sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0))
  return Object.fromEntries(list.slice(0, limit))
}

function same (a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}
