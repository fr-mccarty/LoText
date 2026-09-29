import { describe, it, expect } from 'vitest'
import { sendToDayCap } from '../src/mobile/daycap.js'

/**
 * LoTextNative's DayCap calls over a pretend folder: `files` is what is in it, `present` whether
 * it is still there, and each `choose` answers from `answers`, recording what it was asked.
 */
function fakeNative ({ name = 'Drop', present = true, chosen = true, answers = [] } = {}) {
  const native = {
    files: new Map(),
    asked: [],
    remembered: chosen ? { name, present } : null,
    folder: async () => native.remembered
      ? { name: native.remembered.name, present: native.remembered.present, chosen: true }
      : { present: false, chosen: false },
    choose: async (gone) => {
      native.asked.push(gone)
      const answer = answers.shift() ?? null
      if (answer) native.remembered = { name: answer, present: true }
      return answer
    },
    write: async ({ name: file, text }) => {
      if (!native.remembered?.present) throw Object.assign(new Error('gone'), { code: 'notFound' })
      if (native.files.has(file)) throw Object.assign(new Error('taken'), { code: 'nameTaken' })
      native.files.set(file, text)
    },
  }
  return native
}

describe('Cut and Send to DayCap, on iOS', () => {
  const at = new Date(2026, 8, 28, 9, 5, 7)

  it('writes into the remembered folder without asking', async () => {
    const native = fakeNative()
    expect(await sendToDayCap(native, 'note', at)).toBe('2026-09-28T09:05:07-daycap-note.md')
    expect(native.asked).toEqual([])
    expect(native.files.get('2026-09-28T09:05:07-daycap-note.md')).toBe('note')
  })

  it('moves on to -01 when the name is taken', async () => {
    const native = fakeNative()
    native.files.set('2026-09-28T09:05:07-daycap-note.md', 'first')
    expect(await sendToDayCap(native, 'second', at)).toBe('2026-09-28T09:05:07-daycap-note-01.md')
  })

  it('asks for a folder, naming none gone, when none was ever chosen', async () => {
    const native = fakeNative({ chosen: false, answers: ['Picked'] })
    expect(await sendToDayCap(native, 'note', at)).toBe('2026-09-28T09:05:07-daycap-note.md')
    expect(native.asked).toEqual([null])
  })

  it('asks again, naming the gone folder, when the remembered one is not there', async () => {
    const native = fakeNative({ name: 'Daily-Drop', present: false, answers: ['New-Drop'] })
    expect(await sendToDayCap(native, 'note', at)).toBe('2026-09-28T09:05:07-daycap-note.md')
    expect(native.asked).toEqual(['Daily-Drop'])
    expect(native.files.size).toBe(1)
  })

  it('asks again when the folder goes between the check and the write, then retries', async () => {
    const native = fakeNative({ answers: ['New-Drop'] })
    const write = native.write
    let first = true
    native.write = async (file) => {
      if (first) { first = false; native.remembered.present = false }
      return write(file)
    }
    expect(await sendToDayCap(native, 'note', at)).toBe('2026-09-28T09:05:07-daycap-note.md')
    expect(native.asked).toEqual(['Drop'])
  })

  it('writes nothing and answers null when the question is cancelled', async () => {
    const native = fakeNative({ present: false })
    expect(await sendToDayCap(native, 'note', at)).toBe(null)
    expect(native.files.size).toBe(0)
  })

  it('asks only once: a folder gone again after the answer is an error, not a loop', async () => {
    const native = fakeNative({ answers: ['New-Drop', 'Again'] })
    native.write = async () => { throw Object.assign(new Error('gone'), { code: 'notFound' }) }
    await expect(sendToDayCap(native, 'note', at)).rejects.toThrow('could not be saved in the DayCap folder, New-Drop')
    expect(native.asked).toEqual(['Drop'])
  })

  it('says which folder when the write fails for another reason', async () => {
    const native = fakeNative()
    native.write = async () => { throw Object.assign(new Error('The disk is full.'), { code: 'failed' }) }
    await expect(sendToDayCap(native, 'note', at)).rejects.toThrow('DayCap folder, Drop. The disk is full.')
  })
})
