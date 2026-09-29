import { describe, it, expect } from 'vitest'
import { recentlyEdited } from '../src/shared/store/recent.js'

/** A store over a fixed tree: { path: modified } for files, folders implied by their paths. */
function fakeStore (files) {
  const asked = []
  return {
    asked,
    async children (folder) {
      const prefix = folder ? `${folder}/` : ''
      const names = new Map()
      for (const path of Object.keys(files)) {
        if (!path.startsWith(prefix)) continue
        const rest = path.slice(prefix.length).split('/')
        names.set(prefix + rest[0], rest.length > 1 ? 'folder' : 'file')
      }
      return [...names].map(([path, kind]) => ({ path, kind, isLink: false, leavesTheFolder: false }))
    },
    async modifiedTimes (paths) {
      asked.push(paths)
      return paths.map((path) => files[path])
    },
  }
}

const never = () => false

describe('recently edited', () => {
  it('lists every file in the folder, deep ones too, newest first', async () => {
    const store = fakeStore({ 'a.md': 100, 'notes/b.md': 300, 'notes/deep/c.toml': 200 })
    expect(await recentlyEdited(store, never)).toEqual([
      { path: 'notes/b.md', modified: 300 },
      { path: 'notes/deep/c.toml', modified: 200 },
      { path: 'a.md', modified: 100 },
    ])
  })

  it('asks the store for all the dates at once', async () => {
    const store = fakeStore({ 'a.md': 1, 'b.md': 2 })
    await recentlyEdited(store, never)
    expect(store.asked).toEqual([['a.md', 'b.md']])
  })

  it('keeps only the newest `limit`', async () => {
    const files = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`f${index}.md`, index]))
    const recent = await recentlyEdited(fakeStore(files), never)
    expect(recent).toHaveLength(20)
    expect(recent[0].path).toBe('f29.md')
    expect(recent[19].path).toBe('f10.md')
  })

  it('leaves out a file whose date cannot be read, and the opaque binaries', async () => {
    const store = fakeStore({ 'gone.md': null, 'kept.md': 5, 'archive.zip': 9 })
    expect(await recentlyEdited(store, never)).toEqual([{ path: 'kept.md', modified: 5 }])
  })

  it('breaks a tie by path', async () => {
    const store = fakeStore({ 'b.md': 7, 'a.md': 7 })
    expect((await recentlyEdited(store, never)).map((file) => file.path)).toEqual(['a.md', 'b.md'])
  })

  it('answers null when stopped', async () => {
    expect(await recentlyEdited(fakeStore({ 'a.md': 1 }), () => true)).toBeNull()
  })
})
