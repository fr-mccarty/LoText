// A file from outside — a double-click in Finder, an Open With, a drop on the Dock icon, or a
// path named on the command line.
//
// The system hands the app the path and the app has to decide which window takes it, which it
// often cannot answer yet: opening a document is also how the app gets *launched*, and the
// open event can land before a single window has restored its folder. A window that does not
// exist cannot be handed anything, and the file must not be dropped for having arrived first.
//
// So an arriving path **waits in a queue**, in arrival order, and every window calls in as it
// finishes restoring. Delivery stops at the first path nothing can take, so files keep the
// order they were opened in.
//
// Who may claim one:
//   · a window whose folder already holds the file
//   · else a window with no folder open
//   · else one new window — asked for, then waited for
//
// "A window has already been asked for" is remembered, and that is the whole job of it: it
// keeps the third case to ONE new window rather than one per delivery attempt. The front
// window is deliberately not on the list — it would close a folder somebody is working in
// because they double-clicked a file somewhere else.

import path from 'node:path'
import { app } from 'electron'
import * as Windows from './window.js'

const queue = []
let awaitingNewWindow = false

export function enqueue (filePath) {
  queue.push(path.resolve(filePath))
  deliver()
}

/** Whether anything in the queue is inside `folder`, asked by a window before it restores. */
export function claimsWithin (folder) {
  return queue.some((file) => isInside(file, folder))
}

export function deliver () {
  // Electron cannot make a window before `ready`; the launch delivers again once it can.
  if (!app.isReady()) return
  while (queue.length) {
    const file = queue[0]
    const taker = findTaker(file)
    if (!taker) {
      // A window that exists but has not finished restoring is not a window that cannot take
      // the file — it is one that cannot answer yet, and it calls in the moment it can. Asking
      // for another one now would put up an empty extra window for a file already spoken for.
      if (Windows.allWindows().some((entry) => !entry.isReady)) return
      if (!awaitingNewWindow) {
        awaitingNewWindow = true
        Windows.createWindow()
      }
      return                                 // stop at the first one nothing can take
    }
    queue.shift()
    awaitingNewWindow = false
    taker.send('app:openFile', file)
  }
}

function findTaker (file) {
  const candidates = Windows.allWindows().filter((entry) => entry.isReady)
  const holder = candidates.find((entry) =>
    entry.store?.kind === 'local' && isInside(file, entry.store.root))
  if (holder) return holder
  return candidates.find((entry) => !entry.store) ?? null
}

function isInside (file, folder) {
  const relative = path.relative(folder, file)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}
