import { describe, it, expect } from 'vitest'
import { walk, LISTING_CONCURRENCY } from '../src/shared/store/walk.js'

/** A tree of `width` folders under the root, each holding one file, listed after `delay` ms. */
function slowStore (width, delay, { concurrency } = {}) {
  let inFlight = 0
  const store = {
    peak: 0,
    listed: 0,
    async children (folder) {
      inFlight += 1
      store.peak = Math.max(store.peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, delay))
      inFlight -= 1
      store.listed += 1
      if (folder === 'bad') throw new Error('unreadable')
      if (folder === '') {
        return Array.from({ length: width }, (_, index) =>
          ({ path: index === 3 ? 'bad' : `f${index}`, kind: 'folder', isLink: false, leavesTheFolder: false }))
      }
      return [{ path: `${folder}/note.md`, kind: 'file', isLink: false, leavesTheFolder: false }]
    },
  }
  if (concurrency) store.listingConcurrency = concurrency
  return store
}

const collect = async (store, shouldStop = () => false) => {
  const files = []
  await walk(store, (batch) => files.push(...batch.files), shouldStop)
  return files
}

describe('walk', () => {
  it('lists several folders of a level at once, and no more than the limit', async () => {
    const store = slowStore(20, 5)
    await collect(store)
    expect(store.peak).toBe(LISTING_CONCURRENCY)
  })

  it('answers in the same order as listing one at a time, skipping an unreadable folder', async () => {
    const together = await collect(slowStore(20, 1))
    const oneByOne = await collect(slowStore(20, 1, { concurrency: 1 }))
    expect(together).toEqual(oneByOne)
    expect(together).toHaveLength(19)
    expect(together.slice(0, 4)).toEqual(['f0/note.md', 'f1/note.md', 'f2/note.md', 'f4/note.md'])
  })

  it('lists one at a time for a store that asks for it', async () => {
    const store = slowStore(10, 1, { concurrency: 1 })
    await collect(store)
    expect(store.peak).toBe(1)
  })

  it('stops between listings when asked', async () => {
    const store = slowStore(40, 1)
    let asks = 0
    await collect(store, () => ++asks > 2)
    expect(store.listed).toBe(1 + LISTING_CONCURRENCY)
  })
})
