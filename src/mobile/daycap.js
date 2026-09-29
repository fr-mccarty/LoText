// Cut and Send to DayCap on iOS: what `send` in src/main/daycap.js is on the Mac. The folder is a
// bookmark the native side keeps, so this only decides when to ask for it and what to name the
// file; `native` is the handful of calls that reach LoTextNative, passed in so tests can stand in.
//
//   native.folder()      → { name?, present, chosen }: the remembered folder, whether it is still
//                          there, and whether one was ever chosen
//   native.choose(gone)  → the chosen folder's name, or null when the question was cancelled.
//                          `gone` names a remembered folder that is no longer there.
//   native.write({ name, text }) → rejects with code `nameTaken` or `notFound`

import { dayCapFileName } from '../shared/daycap.js'

/**
 * Saves `text` as a new file in the DayCap folder, asking for the folder first when none has
 * been chosen or the chosen one has gone — and once more if it goes while being written to. The
 * new file's name, or null when the question was cancelled. A taken name moves on to the next.
 */
export async function sendToDayCap (native, text, now = new Date()) {
  const remembered = await native.folder()
  let folder = remembered.present ? remembered.name : null
  if (!folder) {
    folder = await native.choose(remembered.chosen ? goneName(remembered) : null)
    if (!folder) return null
  }
  let askedAgain = false
  for (let attempt = 1; ;) {
    const name = dayCapFileName(now, attempt)
    try {
      await native.write({ name, text })
      return name
    } catch (error) {
      if (error?.code === 'nameTaken') { attempt += 1; continue }
      if (error?.code === 'notFound' && !askedAgain) {
        askedAgain = true
        folder = await native.choose(folder)
        if (!folder) return null
        continue
      }
      throw new Error(`The text could not be saved in the DayCap folder, ${folder}. ${error?.message ?? ''}`.trim())
    }
  }
}

/** A bookmark that no longer resolves has no name left to give. */
const goneName = (remembered) => remembered.name ?? 'chosen before'
