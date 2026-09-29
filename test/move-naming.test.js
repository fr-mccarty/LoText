import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { LocalStore } from '../src/main/store/local-store.js'
import { numberedName } from '../src/shared/store/names.js'

describe('numberedName', () => {
  it('puts the number before the extension', () => {
    expect(numberedName('validation.md', 2)).toBe('validation-2.md')
    expect(numberedName('archive.tar.gz', 3)).toBe('archive.tar-3.gz')
    expect(numberedName('README', 2)).toBe('README-2')
    expect(numberedName('.env', 2)).toBe('.env-2')
  })
})

describe('LocalStore.move', () => {
  let root
  let store
  const write = (relative, text) => fs.writeFile(path.join(root, relative), text)
  const read = (relative) => fs.readFile(path.join(root, relative), 'utf8')

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'lotext-move-'))
    await fs.mkdir(path.join(root, 'into'))
    store = new LocalStore(root)
  })
  afterEach(() => fs.rm(root, { recursive: true, force: true }))

  it('keeps the name when nothing holds it', async () => {
    await write('validation.md', 'moved')
    expect(await store.move('validation.md', 'into')).toBe('into/validation.md')
    expect(await read('into/validation.md')).toBe('moved')
  })

  it('takes the first free -N name rather than overwrite', async () => {
    await write('validation.md', 'moved')
    await write('into/validation.md', 'first')
    await write('into/validation-2.md', 'second')
    expect(await store.move('validation.md', 'into')).toBe('into/validation-3.md')
    expect(await read('into/validation.md')).toBe('first')
    expect(await read('into/validation-2.md')).toBe('second')
    expect(await read('into/validation-3.md')).toBe('moved')
  })
})

describe('LocalStore.move onto another disk', () => {
  let root
  let store
  const write = (relative, text) => fs.writeFile(path.join(root, relative), text)
  const read = (relative) => fs.readFile(path.join(root, relative), 'utf8')
  const present = (relative) => fs.access(path.join(root, relative)).then(() => true, () => false)
  const crossDevice = () => Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' })

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'lotext-move-'))
    await fs.mkdir(path.join(root, 'into'))
    store = new LocalStore(root)
    vi.spyOn(fs, 'rename').mockRejectedValue(crossDevice())
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('copies the file across and removes the original', async () => {
    await write('spec.md', 'moved')
    const old = new Date('2024-01-02T03:04:05Z')
    await fs.utimes(path.join(root, 'spec.md'), old, old)
    expect(await store.move('spec.md', 'into')).toBe('into/spec.md')
    expect(await read('into/spec.md')).toBe('moved')
    expect(await present('spec.md')).toBe(false)
    expect((await fs.stat(path.join(root, 'into/spec.md'))).mtime.getTime()).toBe(old.getTime())
  })

  it('copies a folder whole', async () => {
    await fs.mkdir(path.join(root, 'notes/deep'), { recursive: true })
    await write('notes/a.md', 'a')
    await write('notes/deep/b.md', 'b')
    expect(await store.move('notes', 'into')).toBe('into/notes')
    expect(await read('into/notes/a.md')).toBe('a')
    expect(await read('into/notes/deep/b.md')).toBe('b')
    expect(await present('notes')).toBe(false)
  })

  it('still takes a -N name rather than overwrite', async () => {
    await write('spec.md', 'moved')
    await write('into/spec.md', 'first')
    expect(await store.move('spec.md', 'into')).toBe('into/spec-2.md')
    expect(await read('into/spec.md')).toBe('first')
    expect(await read('into/spec-2.md')).toBe('moved')
  })

  it('leaves the original and no partial copy when the copy fails', async () => {
    await write('spec.md', 'moved')
    vi.spyOn(fs, 'cp').mockImplementation(async (source, target) => {
      await fs.writeFile(target, 'mov')                       // half written, then the share drops
      throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' })
    })
    await expect(store.move('spec.md', 'into')).rejects.toThrow('EIO')
    expect(await read('spec.md')).toBe('moved')
    expect(await present('into/spec.md')).toBe(false)
  })

  it('leaves the original when the copy does not match', async () => {
    await write('spec.md', 'moved')
    vi.spyOn(fs, 'cp').mockImplementation((source, target) => fs.writeFile(target, 'MOVED'))
    await expect(store.move('spec.md', 'into')).rejects.toThrow('does not match')
    expect(await read('spec.md')).toBe('moved')
    expect(await present('into/spec.md')).toBe(false)
  })

  it('passes other errors through untouched', async () => {
    await write('spec.md', 'moved')
    fs.rename.mockRejectedValue(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))
    await expect(store.move('spec.md', 'into')).rejects.toThrow('EACCES')
    expect(await read('spec.md')).toBe('moved')
  })
})
