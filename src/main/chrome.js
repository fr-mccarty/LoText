// The frame around a window's page, which is the one part of a window that differs by platform.
//
// On the Mac the title bar is a strip of the window, the traffic lights inset into it, and the
// sidebar's material shows through the page's transparent background. Windows has none of that
// to borrow: it gets its ordinary frame, with the menu bar under the title where people look
// for it, and an opaque background in the system's light or dark — the page is transparent, so
// this colour *is* the sidebar.

import { BrowserWindow, nativeTheme } from 'electron'

export const isMac = process.platform === 'darwin'

const background = () => (nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3')

/** `material` is the Mac vibrancy: `sidebar` for a folder window, `window` for the panel. */
export function chromeOptions (material) {
  if (isMac) {
    return {
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#00000000',
      vibrancy: material,
      visualEffectState: 'followWindow',
    }
  }
  return { backgroundColor: background(), autoHideMenuBar: false }
}

/** Every window's background follows a switch between light and dark, as vibrancy does by itself. */
export function followThemeOutsideMac () {
  if (isMac) return
  nativeTheme.on('updated', () => {
    for (const browser of BrowserWindow.getAllWindows()) browser.setBackgroundColor(background())
  })
}
