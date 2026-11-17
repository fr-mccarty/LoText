import { describe, it, expect, afterEach } from 'vitest'
import { isListed, setHiddenFilesShown } from '../src/shared/store/names.js'
import { normalizeView } from '../src/shared/settings-shape.js'

afterEach(() => setHiddenFilesShown(false))

describe('Show Hidden Files', () => {
  it('is off by default', () => {
    expect(normalizeView({}).showHiddenFiles).toBe(false)
    expect(normalizeView({ showHiddenFiles: 1 }).showHiddenFiles).toBe(true)
  })

  it('leaves dot names out while off', () => {
    expect(isListed('notes.md')).toBe(true)
    expect(isListed('.git')).toBe(false)
    expect(isListed('.env')).toBe(false)
  })

  it('lists them while on, but never . , .. or an iCloud placeholder', () => {
    setHiddenFilesShown(true)
    expect(isListed('.git')).toBe(true)
    expect(isListed('.env')).toBe(true)
    expect(isListed('.')).toBe(false)
    expect(isListed('..')).toBe(false)
    expect(isListed('.notes.md.icloud')).toBe(false)
  })
})
