// The one native plugin, LoTextNative (ios/App/App/LoTextNative.swift). Everything iOS does for
// the app — the folder, its files, the app's own data, alerts, menus, pickers, printing — is a
// method on it, and nothing else in src/mobile/ reaches past this file to the platform.
//
// Every file path handed across is store-relative (src/shared/file-path.js); the native side
// resolves it against the folder it is holding open and refuses anything that would leave it.

import { registerPlugin } from '@capacitor/core'

export const Native = registerPlugin('LoTextNative')

/** base64 → bytes. The bridge carries bytes as base64, both ways. */
export function fromBase64 (text) {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function toBase64 (bytes) {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode.apply(null, bytes.subarray(start, start + 8192))
  }
  return btoa(binary)
}

/**
 * Where the finger or the pointer last came down, in page coordinates. On iPad a menu is a
 * popover and has to point at something; asking every caller where it was tapped would thread a
 * position through code that has no reason to know one.
 */
export const lastPointer = { x: 0, y: 0 }
document.addEventListener('pointerdown', (event) => {
  lastPointer.x = event.clientX
  lastPointer.y = event.clientY
}, true)

/**
 * The system's action sheet: a list of choices, and Cancel. Resolves with the chosen index, or
 * -1 for Cancel or a tap outside it. `at: null` is a list that belongs to no one spot — Move
 * To…'s folders — and is centred rather than pointing at wherever the last tap happened to be.
 */
export async function chooseFrom (items, { title = null, at = lastPointer } = {}) {
  const { index } = await Native.menu({
    title,
    items: items.map((item) => ({ title: item.title, destructive: Boolean(item.destructive) })),
    x: at?.x,
    y: at?.y,
  })
  return index
}
