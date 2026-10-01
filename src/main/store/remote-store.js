// A remote folder on the Mac: the shared store (`src/shared/store/remote-store.js`) over
// `/usr/bin/ssh`, plus the one thing only the Mac needs — a copy on disk for the viewer that can
// only take a path.

import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import * as FilePath from '../../shared/file-path.js'
import { RemoteStore as SharedRemoteStore } from '../../shared/store/remote-store.js'
import { sshTransport } from './ssh-transport.js'

export class RemoteStore extends SharedRemoteStore {
  constructor (location) {
    super(location, sshTransport)
    this.fetched = new Map()                // remote path → a local copy, for the viewers
  }

  close () {
    super.close()
    for (const copy of this.fetched.values()) fs.rm(copy, { force: true }).catch(() => {})
    this.fetched.clear()
  }

  /**
   * A copy of a remote file inside the app's own data directory, for the one viewer that can
   * only take a path. It is a copy to look at, never written back, and it goes when the window
   * does.
   */
  async fetchForViewing (relative) {
    const existing = this.fetched.get(relative)
    if (existing) return existing
    const { data } = await this.read(relative)
    const directory = path.join(os.tmpdir(), 'lotext-remote')
    await fs.mkdir(directory, { recursive: true })
    const copy = path.join(directory, `${Date.now()}-${FilePath.name(relative)}`)
    await fs.writeFile(copy, data)
    this.fetched.set(relative, copy)
    return copy
  }
}
