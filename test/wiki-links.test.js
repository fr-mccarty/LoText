import { describe, it, expect } from 'vitest'
import { linksOn, resolveLink, linkText, linkBase, opensLink } from '../src/renderer/editor/wiki-links.js'

describe('finding links', () => {
  it('finds every [[target]] on a line', () => {
    expect(linksOn('see [[notes.md]] and [[sub/plan.md]]')).toEqual([
      { from: 4, to: 16, target: 'notes.md' },
      { from: 21, to: 36, target: 'sub/plan.md' },
    ])
  })

  it('takes no empty or broken brackets', () => {
    expect(linksOn('[[]] [[ a ] [a]] [x]')).toEqual([])
  })
})

describe('reading a link', () => {
  it('is read from the folder the file is in', () => {
    expect(linkBase('a/b/today.md')).toBe('a/b')
    expect(linkBase('today.md')).toBe('')
    expect(resolveLink('a/today.md', 'sub/plan.md')).toBe('a/sub/plan.md')
    expect(resolveLink('today.md', 'plan.md')).toBe('plan.md')
  })

  it('never climbs out of that folder', () => {
    expect(resolveLink('a/today.md', '../secret.md')).toBe('a/secret.md')
  })
})

describe('writing a link', () => {
  it('is the chosen file’s path from the file’s folder', () => {
    expect(linkText('a/today.md', 'a/plan.md')).toBe('plan.md')
    expect(linkText('a/today.md', 'a/sub/deep/plan.md')).toBe('sub/deep/plan.md')
    expect(linkText('today.md', 'sub/plan.md')).toBe('sub/plan.md')
  })

  it('opens on the second [ only', () => {
    expect(opensLink('see [')).toBe(true)
    expect(opensLink('[')).toBe(true)
    expect(opensLink('see ')).toBe(false)
    expect(opensLink('[[')).toBe(false)
  })
})

describe('typing [[ and choosing a file', async () => {
  const { EditorState, EditorSelection } = await import('@codemirror/state')
  const { EditorView } = await import('@codemirror/view')
  const { history, undo } = await import('@codemirror/commands')
  const { wikiLinks, insertLink } = await import('../src/renderer/editor/wiki-links.js')

  function editorWith (doc, onRequestLink) {
    let state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [history(), wikiLinks({ onRequestLink })],
    })
    const view = {
      get state () { return state },
      dispatch: (...specs) => { state = state.update(...specs).state },
      focus () {},
    }
    const type = (text) => {
      const { from, to } = state.selection.main
      const handled = state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, text, () => null))
      if (!handled) view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.type' })
    }
    return { view, type }
  }

  it('asks for a file on the second [, then writes the link and closes it', () => {
    const asked = []
    const { view, type } = editorWith('see ', (_view, at) => asked.push(at))
    type('[')
    expect(asked).toEqual([])
    type('[')
    expect(asked).toEqual([6])
    expect(view.state.doc.toString()).toBe('see [[')
    insertLink(view, 6, 'sub/plan.md')
    expect(view.state.doc.toString()).toBe('see [[sub/plan.md]]')
    expect(view.state.selection.main.head).toBe(view.state.doc.length)
  })

  it('writes nothing once the [[ is gone', () => {
    const { view } = editorWith('see [x', () => {})
    expect(insertLink(view, 6, 'plan.md')).toBe(false)
    expect(view.state.doc.toString()).toBe('see [x')
  })

  it('one ⌘Z takes the chosen link back out', () => {
    const { view, type } = editorWith('', () => {})
    type('['); type('[')
    insertLink(view, 2, 'plan.md')
    undo(view)
    expect(view.state.doc.toString()).toBe('[[')
  })
})
