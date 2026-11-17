import { describe, it, expect, vi } from 'vitest'
import { Sidebar } from '../src/renderer/sidebar/sidebar.js'

/** The row menu a right-click on `node` offers, in a folder with `capabilities`. */
function rowMenuFor (node, capabilities, selected = []) {
  const copyAbsolutePath = vi.fn(async () => true)
  const requestDeleteMany = vi.fn(async () => {})
  const sidebar = Object.create(Sidebar.prototype)
  sidebar.model = {
    folder: { capabilities },
    notify () {},
    bridge: { copyAbsolutePath },
    isSelected: (path) => selected.includes(path),
    selectedTopmost: () => selected,
    requestDeleteMany,
  }
  let items = []
  sidebar.presentMenu = (_event, offered) => { items = offered }
  sidebar.showRowMenu({ preventDefault () {}, stopPropagation () {} }, node)
  return { items, copyAbsolutePath, requestDeleteMany }
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

describe('the row menu over several selected rows', () => {
  it('offers to delete them all at once', () => {
    const { items, requestDeleteMany } = rowMenuFor({ kind: 'file', path: 'b' }, { localPath: true }, ['a', 'b', 'c'])
    expect(items.map((item) => item.label)).toEqual(['Delete 3 Items'])
    items[0].action()
    expect(requestDeleteMany).toHaveBeenCalledWith(['a', 'b', 'c'])
  })

  it('is the one row’s own menu on a row outside the selection', () => {
    const { items } = rowMenuFor({ kind: 'file', path: 'z' }, { localPath: true }, ['a', 'b'])
    expect(items.map((item) => item.label)).toContain('Rename')
  })
})
