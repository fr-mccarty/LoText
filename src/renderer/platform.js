// What the window says differently on Windows: shortcuts spelled Ctrl+Shift+N rather than ⇧⌘N,
// the Recycle Bin and File Explorer rather than the Trash and the Finder. Wording only — the
// model and the bridge behave the same everywhere (CLAUDE.md).
//
// The Mac and iOS keep the glyphs: an iPad's keyboard has a ⌘ key too.

const platform = globalThis.window?.lotext?.platform ?? 'darwin'

export const isWindows = platform === 'win32'

/** The body's class, so the stylesheet can drop the Mac's title-bar inset. */
export function markPlatform () {
  document.body.classList.add(`platform-${platform}`)
}

const MODIFIERS = [['⌃', 'Ctrl'], ['⌘', 'Ctrl'], ['⌥', 'Alt'], ['⇧', 'Shift']]
const KEY_NAMES = { '⌫': 'Backspace', '⌦': 'Delete', '⎋': 'Esc', '↩': 'Enter' }

/** `⇧⌘N` → `Ctrl+Shift+N`, `⌥↑` → `Alt+↑`, anywhere in a sentence; unchanged on the Mac. */
export function keys (text) {
  if (!isWindows) return text
  return text.replace(/([⌃⌥⇧⌘]+)([⌫⌦⎋↩]|\S)|[⌫⌦]/g, (whole, mods, key) => {
    if (!mods) return KEY_NAMES[whole]
    const names = [...new Set(MODIFIERS.filter(([glyph]) => mods.includes(glyph)).map(([, name]) => name))]
    return [...names, KEY_NAMES[key] ?? key.toUpperCase()].join('+')
  })
}

export const words = isWindows
  ? { trash: 'Recycle Bin', fileManager: 'File Explorer', computer: 'computer', thisComputer: 'this computer' }
  : { trash: 'Trash', fileManager: 'Finder', computer: 'Mac', thisComputer: 'this Mac' }
