import { describe, it, expect, vi } from 'vitest'
import { Sidebar } from '../src/renderer/sidebar/sidebar.js'

/** The row menu a right-click on `node` offers, in a folder with `capabilities`. */
function rowMenuFor (node, capabilities) {
  const copyAbsolutePath = vi.fn(async () => true)
  const sidebar = Object.create(Sidebar.prototype)
  sidebar.model = { folder: { capabilities }, notify () {}, bridge: { copyAbsolutePath } }
  let items = []
  sidebar.presentMenu = (_event, offered) => { items = offered }
  sidebar.showRowMenu({ preventDefault () {}, stopPropagation () {} }, node)
  return { items, copyAbsolutePath }
}

describe('Copy Absolute Path in the sidebar’s row menu', () => {
  for (const kind of ['file', 'folder']) {
    it(`is offered on a ${kind} and copies that ${kind}’s path`, () => {
      const { items, copyAbsolutePath } = rowMenuFor({ kind, path: 'notes/a' }, { localPath: true })
      const item = items.find((candidate) => candidate.label === 'Copy Absolute Path')
      item.action()
      expect(copyAbsolutePath).toHaveBeenCalledWith('notes/a')
    })
  }

  it('is left out where the folder has no path on this machine: a server, or iOS', () => {
    const { items } = rowMenuFor({ kind: 'file', path: 'a' }, { localPath: false })
    expect(items.map((item) => item.label)).not.toContain('Copy Absolute Path')
  })
})
