// What the window says differently by platform: shortcuts spelled Ctrl+Shift+N rather than ⇧⌘N on
// Windows and on an Android tablet's keyboard, and the Recycle Bin and File Explorer rather than
// the Trash and the Finder on Windows. Wording only — the model and the bridge behave the same
// everywhere (CLAUDE.md).
//
// The Mac and iOS keep the glyphs: an iPad's keyboard has a ⌘ key too.
//
// Read when asked rather than when this file loads: on iOS and Android the bridge is put in place
// as the page starts, and this may be loaded before it.

const platform = () => globalThis.window?.lotext?.platform ?? 'darwin'

export const isWindows = () => platform() === 'win32'

/** Ctrl, not ⌘: Windows, and a keyboard plugged into an Android device. */
const spellsKeys = () => platform() === 'win32' || platform() === 'android'

/** The body's class, so the stylesheet can drop the Mac's title-bar inset. */
export function markPlatform () {
  document.body.classList.add(`platform-${platform()}`)
}

const MODIFIERS = [['⌃', 'Ctrl'], ['⌘', 'Ctrl'], ['⌥', 'Alt'], ['⇧', 'Shift']]
const KEY_NAMES = { '⌫': 'Backspace', '⌦': 'Delete', '⎋': 'Esc', '↩': 'Enter' }

/** `⇧⌘N` → `Ctrl+Shift+N`, `⌥↑` → `Alt+↑`, anywhere in a sentence; unchanged on the Mac. */
export function keys (text) {
  if (!spellsKeys()) return text
  return text.replace(/([⌃⌥⇧⌘]+)([⌫⌦⎋↩]|\S)|[⌫⌦]/g, (whole, mods, key) => {
    if (!mods) return KEY_NAMES[whole]
    const names = [...new Set(MODIFIERS.filter(([glyph]) => mods.includes(glyph)).map(([, name]) => name))]
    return [...names, KEY_NAMES[key] ?? key.toUpperCase()].join('+')
  })
}

const WORDS = {
  win32: { trash: 'Recycle Bin', fileManager: 'File Explorer', computer: 'computer', thisComputer: 'this computer' },
  darwin: { trash: 'Trash', fileManager: 'Finder', computer: 'Mac', thisComputer: 'this Mac' },
}

/** `words.trash`, `words.fileManager`, … — the Mac's on every platform that has no words of its own. */
export const words = new Proxy({}, { get: (_target, key) => (WORDS[platform()] ?? WORDS.darwin)[key] })
