// The shared remote store (src/shared/store/remote-store.js) — the one the Mac runs over
// /usr/bin/ssh and iPhone/iPad over the native plugin — driven through a transport that runs
// the command with this machine's own /bin/sh, so the real remote script does the work.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RemoteStore } from '../src/shared/store/remote-store.js'
import { parseLocation, address } from '../src/shared/store/remote-location.js'

/** Runs the command as the far side's login shell would: one string, handed to sh. */
const localShell = {
  run ({ command, input }) {
    return new Promise((resolve) => {
      const child = spawn('/bin/sh', ['-c', command])
      const out = []
      const err = []
      child.stdout.on('data', (chunk) => out.push(chunk))
      child.stderr.on('data', (chunk) => err.push(chunk))
      child.on('close', (status) => resolve({
        status,
        output: new Uint8Array(Buffer.concat(out)),
        diagnostic: Buffer.concat(err).toString('utf8').trim(),
      }))
      child.stdin.end(input ?? undefined)
    })
  },
}

const text = (bytes) => new TextDecoder().decode(bytes)
const bytes = (string) => new TextEncoder().encode(string)

describe('the shared remote store', () => {
  let folder
  let store

  beforeEach(async () => {
    folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lotext-remote-')))
    await fs.writeFile(path.join(folder, 'notes.md'), 'hello\n')
    await fs.mkdir(path.join(folder, 'drafts'))
    store = new RemoteStore(parseLocation(`me@example.com:${folder}`), localShell)
    await store.connect()
  })

  afterEach(async () => {
    await fs.rm(folder, { recursive: true, force: true })
  })

  it('resolves the folder and lists it, folders first', async () => {
    expect(store.absoluteRoot).toBe(folder)
    const nodes = await store.children('')
    expect(nodes.map((node) => `${node.kind} ${node.path}`)).toEqual(['folder drafts', 'file notes.md'])
  })

  it('reads a file with its stamp, and writes it back', async () => {
    const { data, stamp } = await store.read('notes.md')
    expect(text(data)).toBe('hello\n')
    const written = await store.write(bytes('changed\n'), 'notes.md', stamp)
    expect(written.size).toBe(8)
    expect(await fs.readFile(path.join(folder, 'notes.md'), 'utf8')).toBe('changed\n')
  })

  it('refuses a save over a file that changed underneath', async () => {
    const { stamp } = await store.read('notes.md')
    const later = new Date(stamp.modified + 60000)
    await fs.utimes(path.join(folder, 'notes.md'), later, later)
    await expect(store.write(bytes('mine\n'), 'notes.md', stamp)).rejects.toMatchObject({ code: 'conflict' })
    expect(await fs.readFile(path.join(folder, 'notes.md'), 'utf8')).toBe('hello\n')
  })

  it('moves onto a taken name as name-2', async () => {
    await fs.writeFile(path.join(folder, 'drafts', 'notes.md'), 'other\n')
    expect(await store.move('notes.md', 'drafts')).toBe('drafts/notes-2.md')
  })

  it('reads ssh failing to connect as the server refusing, not as a missing file', async () => {
    const refusing = new RemoteStore(parseLocation('me@example.com:/x'), {
      run: async () => ({ status: 255, output: new Uint8Array(), diagnostic: 'me@example.com: Permission denied (publickey).' }),
    })
    await expect(refusing.connect()).rejects.toMatchObject({ code: 'refused' })
    expect(refusing.isUnavailable).toBe(true)
  })
})

describe('a remembered server address', () => {
  it.each([
    'Leo@203.0.113.5:stleo-office',
    'me@host:/srv/notes',
    'ssh://me@host:2222/srv/notes',
    'ssh://me@host:2222/~/notes',
  ])('reads back as the same location: %s', (typed) => {
    const location = parseLocation(typed)
    expect(parseLocation(address(location))).toEqual(location)
  })
})
