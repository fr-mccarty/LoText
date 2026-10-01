// The tag after the folder's name in the sidebar: SSH for a server, MNT for a mounted volume,
// never both.

import { describe, it, expect } from 'vitest'
import { folderTag } from '../src/renderer/sidebar/sidebar.js'

const text = (folder) => folderTag(folder)?.text ?? null

describe('the folder tag', () => {
  it('is SSH for a folder on a server', () => {
    expect(text({ kind: 'remote', name: 'stleo-office' })).toBe('SSH')
  })

  it('is MNT for a folder on a mounted volume', () => {
    expect(text({ kind: 'local', name: 'home', isMounted: true })).toBe('MNT')
  })

  it('is nothing for a folder on the Mac’s own disk', () => {
    expect(text({ kind: 'local', name: 'Documents', isMounted: false })).toBe(null)
    expect(text({ kind: 'local', name: 'LoText' })).toBe(null)
  })

  it('is only ever one tag: a server folder is SSH even if it were marked mounted', () => {
    expect(text({ kind: 'remote', name: 'x', isMounted: true })).toBe('SSH')
  })
})
