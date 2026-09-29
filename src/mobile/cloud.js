// The iPhone and iPad end of iCloud sync (src/shared/sync/cloud-sync.js): the app's iCloud
// container, `iCloud.com.lolekproductions.lotext`, reached through the native side, which does
// the file coordination and the downloading a ubiquitous file needs (LoTextNative+Cloud.swift).
//
// The native side watches the folder with a metadata query and says `cloudChanged` when another
// device's file arrives; coming forward reads it again as well, and going to the background
// writes this device's file.

import { Native } from './native.js'

export const cloudFolder = {
  async available () {
    const { available } = await Native.cloudAvailable()
    return Boolean(available)
  },
  unavailableMessage () {
    return 'iCloud is not available. Sign in to iCloud and turn on iCloud Drive in the Settings app.'
  },
  async list () {
    const { names } = await Native.cloudList()
    return names ?? []
  },
  async read (name) {
    const { text } = await Native.cloudRead({ name })
    return text ?? null
  },
  async write (name, text) {
    await Native.cloudWrite({ name, text })
  },
}

/** Refresh on coming forward and on news from iCloud; write on the way to the background. */
export function watchCloud (cloud) {
  Native.addListener('cloudChanged', () => cloud.refresh())
  Native.addListener('appState', ({ active }) => {
    if (active) cloud.refresh()
    else cloud.flush()
  })
}
