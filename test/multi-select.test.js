import { describe, it, expect } from 'vitest'
import { AppModel } from '../src/renderer/model.js'

/** A model whose tree shows `a/`, `a/x.md`, `b.md`, `c.md` — `a` twirled open. */
function modelWithRows () {
  const model = new AppModel({ platform: 'darwin' })
  model.notify = () => {}
  model.tree.children.set('', [
    { path: 'a', name: 'a', kind: 'folder' },
    { path: 'b.md', name: 'b.md', kind: 'file' },
    { path: 'c.md', name: 'c.md', kind: 'file' },
  ])
  model.tree.children.set('a', [{ path: 'a/x.md', name: 'x.md', kind: 'file' }])
  model.tree.expanded.add('a')
  return model
}

describe('selecting several sidebar rows', () => {
  it('⌘-click adds a row and takes it away again', () => {
    const model = modelWithRows()
    model.selectedPath = 'b.md'
    model.toggleSelected('c.md')
    expect(model.selectedPaths.sort()).toEqual(['b.md', 'c.md'])
    model.toggleSelected('b.md')
    expect(model.selectedPaths).toEqual(['c.md'])
  })

  it('⇧-click takes every visible row from the anchor', () => {
    const model = modelWithRows()
    model.selectedPath = 'a/x.md'
    model.selectRangeTo('c.md')
    expect(model.selectedPaths.sort()).toEqual(['a/x.md', 'b.md', 'c.md'])
    // From the same anchor the other way.
    model.selectRangeTo('a')
    expect(model.selectedPaths.sort()).toEqual(['a', 'a/x.md'])
  })

  it('a plain selection makes one row the only one again', () => {
    const model = modelWithRows()
    model.selectedPath = 'b.md'
    model.toggleSelected('c.md')
    model.selectedPath = 'a'
    expect(model.selectedPaths).toEqual(['a'])
  })

  it('leaves out what a selected folder takes along', () => {
    const model = modelWithRows()
    model.selectedPath = 'a'
    model.toggleSelected('a/x.md')
    model.toggleSelected('b.md')
    expect(model.selectedTopmost().sort()).toEqual(['a', 'b.md'])
  })
})
