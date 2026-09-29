import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSettings } from '../src/shared/settings-store.js'
import { createCloudSync, positionKey } from '../src/shared/sync/cloud-sync.js'

/** Two devices and one iCloud folder, all in memory. */
function memoryPrefs () {
  const data = {}
  return { get: (k, f) => (data[k] === undefined ? f : data[k]), set: (k, v) => { data[k] = v }, flush: () => {}, data }
}

function memoryFolder (files, { available = true } = {}) {
  return {
    writes: 0,
    available: async () => available,
    list: async () => [...files.keys()],
    read: async (name) => files.get(name) ?? null,
    async write (name, text) { this.writes += 1; files.set(name, text) },
  }
}

let clock
function device (name, files, options) {
  const prefs = memoryPrefs()
  let id = 0
  const settings = createSettings(prefs, () => `${name}-preset-${++id}`)
  const folder = memoryFolder(files, options)
  const cloud = createCloudSync({ prefs, settings, folder, deviceName: name, newID: () => name, now: () => clock })
  return { prefs, settings, folder, cloud }
}

beforeEach(() => {
  clock = 1000
  vi.useFakeTimers()
})

describe('iCloud settings sync', () => {
  it('does nothing until turned on', async () => {
    const files = new Map()
    const mac = device('mac', files)
    mac.settings.setView({ editorFontSize: 20 })
    await mac.cloud.refresh()
    expect(files.size).toBe(0)
    expect(mac.cloud.status().state).toBe('off')
  })

  it('publishes on turning on, and a device joining takes the account’s settings', async () => {
    const files = new Map()
    const mac = device('mac', files)
    mac.settings.setView({ editorFontSize: 20, tabSpaces: 4 })
    await mac.cloud.setEnabled(true)
    expect(files.has('mac.json')).toBe(true)

    clock = 2000
    const phone = device('phone', files)
    phone.settings.setView({ editorFontSize: 16 })
    await phone.cloud.setEnabled(true)
    expect(phone.settings.view().editorFontSize).toBe(20)
    expect(phone.settings.view().tabSpaces).toBe(4)
    expect(phone.cloud.status()).toMatchObject({ enabled: true, state: 'on', devices: ['mac'] })
  })

  it('carries a later change across, key by key, newest wins', async () => {
    const files = new Map()
    const mac = device('mac', files)
    const phone = device('phone', files)
    await mac.cloud.setEnabled(true)
    await phone.cloud.setEnabled(true)

    clock = 5000
    mac.settings.setView({ editorFontSize: 22 })
    clock = 6000
    phone.settings.setView({ showInvisibles: true })
    await mac.cloud.flush()
    await phone.cloud.flush()

    await mac.cloud.refresh()
    await phone.cloud.refresh()
    for (const side of [mac, phone]) {
      expect(side.settings.view().editorFontSize).toBe(22)
      expect(side.settings.view().showInvisibles).toBe(true)
    }
  })

  it('syncs the print presets as one unit', async () => {
    const files = new Map()
    const mac = device('mac', files)
    const phone = device('phone', files)
    await mac.cloud.setEnabled(true)
    await phone.cloud.setEnabled(true)

    clock = 5000
    mac.settings.addPreset('stationery')
    await mac.cloud.flush()
    await phone.cloud.refresh()
    expect(phone.settings.presets().map((p) => p.name)).toEqual(['Default', 'Presentation Script', 'Formal Document', 'Letterhead', 'Stationery'])
    expect(phone.settings.activePreset().name).toBe('Stationery')
  })

  it('does not send an arriving value back, and stops writing when nothing changed', async () => {
    const files = new Map()
    const mac = device('mac', files)
    const phone = device('phone', files)
    await mac.cloud.setEnabled(true)
    await phone.cloud.setEnabled(true)
    clock = 5000
    mac.settings.setView({ editorFontSize: 22 })
    await mac.cloud.flush()
    await phone.cloud.refresh()
    const stamp = JSON.parse(files.get('phone.json')).settings['view.editorFontSize'].at
    expect(stamp).toBe(5000)                     // the Mac's time, not a new one of the phone's

    const writes = phone.folder.writes
    await phone.cloud.refresh()
    await phone.cloud.refresh()
    expect(phone.folder.writes).toBe(writes)
  })

  it('waits while iCloud is unreachable, and joins when it answers', async () => {
    const files = new Map()
    const mac = device('mac', files)
    mac.settings.setView({ editorFontSize: 20 })
    await mac.cloud.setEnabled(true)

    const phone = device('phone', files, { available: false })
    await phone.cloud.setEnabled(true)
    expect(phone.cloud.status().state).toBe('unavailable')
    expect(files.has('phone.json')).toBe(false)

    phone.folder.available = async () => true
    await phone.cloud.refresh()
    expect(phone.settings.view().editorFontSize).toBe(20)
    expect(files.has('phone.json')).toBe(true)
  })

  it('ignores a file that is not a sync file', async () => {
    const files = new Map([['junk.json', '{ nope'], ['other.json', '{"format":"x"}']])
    const mac = device('mac', files)
    await mac.cloud.setEnabled(true)
    expect(mac.cloud.status().state).toBe('on')
  })
})

describe('reading positions', () => {
  it('names a document under iCloud Drive the same on the Mac and on iOS', () => {
    const mac = positionKey('/Users/j/Library/Mobile Documents/com~apple~CloudDocs/Notes/a.md')
    const phone = positionKey('/private/var/mobile/Library/Mobile Documents/com~apple~CloudDocs/Notes/a.md')
    expect(mac).toBe('icloud:com~apple~CloudDocs/Notes/a.md')
    expect(phone).toBe(mac)
    expect(positionKey('/Users/j/Projects/a.md')).toBe('local:/Users/j/Projects/a.md')
  })

  it('remembers a position locally whether or not sync is on', () => {
    const mac = device('mac', new Map())
    mac.cloud.rememberPosition('local:/a.md', { anchor: 5, head: 9, top: 3 })
    expect(mac.cloud.position('local:/a.md')).toEqual({ anchor: 5, head: 9, top: 3 })
    expect(mac.cloud.position('local:/b.md')).toBe(null)
  })

  it('carries iCloud Drive positions to the other device, and keeps local ones at home', async () => {
    const files = new Map()
    const mac = device('mac', files)
    const phone = device('phone', files)
    await mac.cloud.setEnabled(true)
    await phone.cloud.setEnabled(true)

    clock = 5000
    mac.cloud.rememberPosition('icloud:com~apple~CloudDocs/a.md', { anchor: 40, head: 40, top: 12 })
    mac.cloud.rememberPosition('local:/Users/j/b.md', { anchor: 7, head: 7, top: 1 })
    await mac.cloud.flush()
    await phone.cloud.refresh()
    expect(phone.cloud.position('icloud:com~apple~CloudDocs/a.md')).toEqual({ anchor: 40, head: 40, top: 12 })
    expect(phone.cloud.position('local:/Users/j/b.md')).toBe(null)

    clock = 6000
    phone.cloud.rememberPosition('icloud:com~apple~CloudDocs/a.md', { anchor: 90, head: 95, top: 30 })
    await phone.cloud.flush()
    await mac.cloud.refresh()
    expect(mac.cloud.position('icloud:com~apple~CloudDocs/a.md')).toEqual({ anchor: 90, head: 95, top: 30 })
  })
})
