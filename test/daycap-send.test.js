import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const showOpenDialog = vi.fn()
let home
vi.mock('electron', () => ({
  app: { getPath: () => home },
  dialog: { showOpenDialog: (...args) => showOpenDialog(...args) },
}))
const saved = {}
vi.mock('../src/main/prefs.js', () => ({
  get: (key, fallback) => (key in saved ? saved[key] : fallback),
  set: (key, value) => { saved[key] = value },
}))

const DayCap = await import('../src/main/daycap.js')

describe('Cut and Send to DayCap, on the Mac', () => {
  let drop
  const at = new Date(2026, 8, 28, 9, 5, 7)

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'lotext-daycap-'))
    drop = path.join(home, 'drop')
    await fs.mkdir(drop)
    for (const key of Object.keys(saved)) delete saved[key]
    showOpenDialog.mockReset()
  })
  afterEach(() => fs.rm(home, { recursive: true, force: true }))

  it('writes the text exactly, under DayCap’s name', async () => {
    const name = await DayCap.writeNote(drop, 'line one\n  line two', at)
    expect(name).toBe('2026-09-28T09:05:07-daycap-note.md')
    expect(await fs.readFile(path.join(drop, name), 'utf8')).toBe('line one\n  line two')
  })

  it('never writes over a file: a taken name moves on to -01', async () => {
    await fs.writeFile(path.join(drop, '2026-09-28T09:05:07-daycap-note.md'), 'first')
    const name = await DayCap.writeNote(drop, 'second', at)
    expect(name).toBe('2026-09-28T09:05:07-daycap-note-01.md')
    expect(await fs.readFile(path.join(drop, '2026-09-28T09:05:07-daycap-note.md'), 'utf8')).toBe('first')
  })

  it('sends to the remembered folder without asking', async () => {
    saved.dayCapFolder = drop
    const name = await DayCap.send(null, 'note')
    expect(name).toMatch(/-daycap-note\.md$/)
    expect(showOpenDialog).not.toHaveBeenCalled()
  })

  it('asks again when the remembered folder has gone, and remembers the answer', async () => {
    saved.dayCapFolder = path.join(home, 'Daily-Drop')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [drop] })
    const name = await DayCap.send(null, 'note')
    expect(showOpenDialog.mock.calls[0][1].message).toContain('Daily-Drop')
    expect(saved.dayCapFolder).toBe(drop)
    expect(await fs.readdir(drop)).toEqual([name])
  })

  it('opens the question at DayCap’s iCloud folder when it is on this Mac', async () => {
    const icloud = path.join(home, 'Library/Mobile Documents/iCloud~org~lolekproductions~daycap/Documents')
    await fs.mkdir(icloud, { recursive: true })
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await DayCap.send(null, 'note')).toBe(null)
    expect(showOpenDialog.mock.calls[0][1].defaultPath).toBe(icloud)
  })
})
