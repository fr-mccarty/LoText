import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/** platform.js reads the bridge once, as it loads, so each platform gets a fresh copy. */
async function load (platform) {
  vi.resetModules()
  globalThis.window = { lotext: { platform } }
  return import('../src/renderer/platform.js')
}

describe('keys', () => {
  let saved
  beforeEach(() => { saved = globalThis.window })
  afterEach(() => { globalThis.window = saved })

  it('spells shortcuts out on Windows, Ctrl before Alt before Shift', async () => {
    const { keys } = await load('win32')
    expect(keys('New Folder (⇧⌘N)')).toBe('New Folder (Ctrl+Shift+N)')
    expect(keys('Find and Replace (⌥⌘F)')).toBe('Find and Replace (Ctrl+Alt+F)')
    expect(keys('press ⌥↑ or ⌥↓')).toBe('press Alt+↑ or Alt+↓')
    expect(keys('⌘[ hides, ⌘] shows')).toBe('Ctrl+[ hides, Ctrl+] shows')
    expect(keys('⌘⌫ and ⌫')).toBe('Ctrl+Backspace and Backspace')
    expect(keys('⇧Tab')).toBe('Shift+Tab')
    expect(keys('⌘z undoes it')).toBe('Ctrl+Z undoes it')
  })

  it('leaves the glyphs alone on the Mac and on iOS', async () => {
    for (const platform of ['darwin', 'ios']) {
      const { keys } = await load(platform)
      expect(keys('New Folder (⇧⌘N)')).toBe('New Folder (⇧⌘N)')
    }
  })

  it('names the Recycle Bin and File Explorer on Windows', async () => {
    const { words } = await load('win32')
    expect([words.trash, words.fileManager]).toEqual(['Recycle Bin', 'File Explorer'])
    globalThis.window = { lotext: { platform: 'darwin' } }
    expect([words.trash, words.fileManager]).toEqual(['Trash', 'Finder'])
  })

  it('spells shortcuts out for a keyboard on Android, and asks the bridge when called', async () => {
    const { keys } = await load('ios')
    globalThis.window = { lotext: { platform: 'android' } }
    expect(keys('Find (⌘F)')).toBe('Find (Ctrl+F)')
  })
})
