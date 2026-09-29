import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const trashItem = vi.fn()
vi.mock('electron', () => ({ shell: { trashItem: (...args) => trashItem(...args) } }))

const { LocalStore } = await import('../src/main/store/local-store.js')

describe('LocalStore.delete on a volume with no Trash', () => {
  let root
  let store
  const present = (relative) => fs.access(path.join(root, relative)).then(() => true, () => false)

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'lotext-delete-'))
    await fs.writeFile(path.join(root, 'ho il.md'), 'text')
    store = new LocalStore(root)
    trashItem.mockReset()
    trashItem.mockRejectedValue(new Error('“ho il.md” couldn’t be moved to the trash because the volume “share” doesn’t have one.'))
  })
  afterEach(() => fs.rm(root, { recursive: true, force: true }))

  it('answers noTrash and leaves the file', async () => {
    await expect(store.delete('ho il.md')).rejects.toMatchObject({ code: 'noTrash' })
    expect(await present('ho il.md')).toBe(true)
  })

  it('removes it only when asked to delete permanently', async () => {
    await fs.mkdir(path.join(root, 'folder'))
    await fs.writeFile(path.join(root, 'folder/a.md'), 'a')
    await store.delete('ho il.md', { permanently: true })
    await store.delete('folder', { permanently: true })
    expect(await present('ho il.md')).toBe(false)
    expect(await present('folder')).toBe(false)
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('still uses the Trash where there is one', async () => {
    trashItem.mockImplementation((target) => fs.rm(target))
    await store.delete('ho il.md')
    expect(trashItem).toHaveBeenCalledWith(path.join(root, 'ho il.md'))
  })
})

describe('restoringErrors', async () => {
  const { restoringErrors } = await import('../src/renderer/bridge-errors.js')

  it('makes the plain object the preload rejects with an Error again, code and all', async () => {
    const bridge = restoringErrors(Object.freeze({ remove: () => Promise.reject({ message: 'no Trash', code: 'noTrash', current: null }) }))
    const error = await bridge.remove('a.md').catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ message: 'no Trash', code: 'noTrash' })
  })

  it('leaves real errors, values and plain functions alone', async () => {
    const thrown = Object.assign(new Error('gone'), { code: 'notFound' })
    const bridge = restoringErrors(Object.freeze({
      platform: 'mac', read: async () => 'text', fail: async () => { throw thrown }, on: () => 'off',
    }))
    expect(bridge.platform).toBe('mac')
    expect(await bridge.read()).toBe('text')
    expect(await bridge.fail().catch((e) => e)).toBe(thrown)
    expect(bridge.on()).toBe('off')
  })

  it('hands back an unfrozen bridge (iOS) as it is', () => {
    const bridge = { platform: 'ios' }
    expect(restoringErrors(bridge)).toBe(bridge)
  })
})
