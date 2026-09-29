import { describe, it, expect } from 'vitest'
import { filesFromArgv } from '../src/main/argv-files.js'

/** A file system where exactly these paths are files. */
const only = (...paths) => (candidate) => paths.includes(candidate)

describe('filesFromArgv', () => {
  it('takes the documents off a packaged command line', () => {
    const argv = ['/Applications/LoText.app/Contents/MacOS/LoText', 'notes.md', 'todo.txt']
    expect(filesFromArgv(argv, { isPackaged: true, exists: only('notes.md', 'todo.txt') }))
      .toEqual(['notes.md', 'todo.txt'])
  })

  it('keeps the order they were given in', () => {
    const argv = ['lotext', 'b.md', 'a.md']
    expect(filesFromArgv(argv, { isPackaged: true, exists: only('a.md', 'b.md') }))
      .toEqual(['b.md', 'a.md'])
  })

  it('drops the app directory that `electron .` passes in development', () => {
    const argv = ['/…/node_modules/electron/dist/Electron', '.', 'notes.md']
    expect(filesFromArgv(argv, { isPackaged: false, exists: only('.', 'notes.md') }))
      .toEqual(['notes.md'])
  })

  it('never treats the executable itself as a document', () => {
    const argv = ['/Applications/LoText.app/Contents/MacOS/LoText']
    const exists = () => true          // even if every path on the line is a real file
    expect(filesFromArgv(argv, { isPackaged: true, exists })).toEqual([])
  })

  it('ignores flags and the values that belong to them', () => {
    // `--out notes.pdf` names a file that does not exist yet; `--preset Letterhead` names no
    // file at all. Neither is something to open.
    const argv = ['lotext', '--pdf', 'notes.md', '--out', 'notes.pdf', '--preset', 'Letterhead']
    expect(filesFromArgv(argv, { isPackaged: true, exists: only('notes.md') }))
      .toEqual(['notes.md'])
  })

  it('ignores an argument that is not a file, including a folder', () => {
    const argv = ['lotext', '/Users/someone/Documents', 'notes.md']
    expect(filesFromArgv(argv, { isPackaged: true, exists: only('notes.md') }))
      .toEqual(['notes.md'])
  })

  it('finds nothing on a plain launch', () => {
    expect(filesFromArgv(['lotext'], { isPackaged: true, exists: () => true })).toEqual([])
    expect(filesFromArgv(['electron', '.'], { isPackaged: false, exists: () => true }))
      .toEqual([])
  })
})
