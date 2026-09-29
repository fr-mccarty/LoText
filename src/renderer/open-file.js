// THE OPEN FILE — there is exactly one, or none.
//
// No tabs, no tab bar, nothing to switch between: opening a file is how you close the one
// before it. The open file remembers its path, its text, whether it is dirty, where the cursor
// is, where it is scrolled, its own undo history, and the line endings the file arrived with.

import * as FilePath from '../shared/file-path.js'

/** Two seconds of quiet is when the working copy is written. This is not a fourth save. */
const RECOVERY_DELAY = 2000

export class OpenFile {
  constructor (path) {
    this.path = path
    this.state = 'loading'                    // loading · ready · missingOnDisk · failed
    this.failure = null
    this.lineEnding = 'lf'
    this.lastStamp = null
    this.isDirty = false
    this.isSaving = false
    /** A save could not go through and the app was in the background when it happened. */
    this.needsAttention = false
    /** One prompt per external change: further events for the same file coalesce into it. */
    this.conflictPending = false
    this.conflictStamp = null
    this.conflictVersionsNoticed = false
    this.recoveryTimer = null
  }

  get fileName () {
    return FilePath.name(this.path)
  }

  scheduleRecovery (write) {
    clearTimeout(this.recoveryTimer)
    if (!this.isDirty) return
    this.recoveryTimer = setTimeout(() => write(), RECOVERY_DELAY)
  }

  cancelRecovery () {
    clearTimeout(this.recoveryTimer)
    this.recoveryTimer = null
  }
}
