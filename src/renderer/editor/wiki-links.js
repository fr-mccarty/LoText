// Wiki links (`specs/wiki-links.md`): `[[notes/today.md]]`, a path relative to the folder the
// open file is in. Typing `[[` asks for a file under that folder — the app shows the Find File
// picker, narrowed to it — and the chosen path is written in and the brackets closed. ⌘-click on
// a link opens the file it names; while ⌘ is held over one, it shows a pointer. A finger has no
// ⌘, so on a touch screen a plain tap on a link opens it.
//
// The link is the text: nothing is hidden or redrawn, it is only marked so it can take a click.

import { Decoration, EditorView, ViewPlugin, MatchDecorator } from '@codemirror/view'
import * as FilePath from '../../shared/file-path.js'
import { isWindows } from '../platform.js'

/** A link: `[[`, a target with no brackets and no line break, `]]`. */
const LINK = /\[\[([^[\]\n]+)\]\]/g

/** Every link on a line, left to right: { from, to, target }, columns in the line. */
export function linksOn (text) {
  return [...text.matchAll(LINK)].map((match) =>
    ({ from: match.index, to: match.index + match[0].length, target: match[1].trim() }))
}

/** The folder a link from `filePath` is read against: the one the file is in. */
export function linkBase (filePath) {
  return FilePath.parent(filePath) ?? FilePath.ROOT
}

/**
 * The store path a link from `filePath` names. Links only reach down from the file's folder: a
 * `..` is dropped, as every path in the app drops it.
 */
export function resolveLink (filePath, target) {
  return FilePath.appending(linkBase(filePath), target)
}

/** What is written between the brackets for `picked`, a file under `filePath`'s folder. */
export function linkText (filePath, picked) {
  const base = FilePath.components(linkBase(filePath))
  return FilePath.components(picked).slice(base.length).join('/')
}

/** Whether typing `[` after `before` (the line up to the caret) makes the `[[` that asks for a file. */
export function opensLink (before) {
  return before.endsWith('[') && !before.endsWith('[[')
}

/** ⌘ on the Mac, Ctrl on Windows: the key that turns a click on a link into following it. */
const followKey = (event) => isWindows() ? event.ctrlKey : event.metaKey

/** How soon after a touch a mousedown counts as that touch's tap, in milliseconds. */
const TAP_WINDOW = 800

const linkMark = Decoration.mark({ class: 'lo-wiki-link' })

const matcher = new MatchDecorator({
  regexp: LINK,
  decorate: (add, from, to) => add(from, to, linkMark),
})

const marks = ViewPlugin.fromClass(class {
  constructor (view) {
    this.decorations = matcher.createDeco(view)
  }

  update (update) {
    this.decorations = matcher.updateDeco(update, this.decorations)
  }
}, { decorations: (plugin) => plugin.decorations })

/** The editor's class while ⌘ is down, so the links under the pointer show that they follow. */
function holdingFollowKey (view, held) {
  view.dom.classList.toggle('lo-follow-key', held)
}

/**
 * The link machinery. `onRequestLink(view, at)` is called after `[[` is typed, `at` just after
 * it; `onFollowLink(target)` with a link's text when it is ⌘-clicked.
 */
export function wikiLinks ({ onRequestLink, onFollowLink }) {
  // When a finger last touched the text. A tap arrives as a touch and then a mousedown; a
  // long-press or a scroll sends no mousedown, so selecting and scrolling over a link still work.
  let lastTouch = 0
  const events = EditorView.domEventHandlers({
    touchstart () { lastTouch = Date.now() },
    mousedown (event, view) {
      const tapped = Date.now() - lastTouch < TAP_WINDOW
      if (event.button !== 0) return false
      if (!tapped && (!followKey(event) || event.shiftKey || event.altKey)) return false
      const target = event.target instanceof Element ? event.target.closest('.lo-wiki-link') : null
      if (!target) return false
      const pos = view.posAtDOM(target)
      const line = view.state.doc.lineAt(pos)
      const link = linksOn(line.text).find((candidate) => line.from + candidate.from === pos)
      if (!link || !link.target) return false
      event.preventDefault()
      onFollowLink?.(link.target)
      return true
    },
    mousemove (event, view) { holdingFollowKey(view, followKey(event)) },
    mouseleave (_event, view) { holdingFollowKey(view, false) },
    keydown (event, view) { if (event.key === 'Meta' || event.key === 'Control') holdingFollowKey(view, followKey(event)) },
    keyup (event, view) { if (event.key === 'Meta' || event.key === 'Control') holdingFollowKey(view, false) },
    blur (_event, view) { holdingFollowKey(view, false) },
  })

  const typing = EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== '[' || from !== to || view.state.selection.ranges.length > 1) return false
    const line = view.state.doc.lineAt(from)
    if (!opensLink(line.text.slice(0, from - line.from))) return false
    view.dispatch({ changes: { from, insert: text }, selection: { anchor: from + 1 }, userEvent: 'input.type' })
    onRequestLink?.(view, from + 1)
    return true
  })

  return [marks, events, typing]
}

/**
 * Writes the chosen link in at `at`, where the caret was after `[[`, and closes the brackets,
 * the caret after them. Nothing happens if those two brackets are no longer there.
 */
export function insertLink (view, at, text) {
  const doc = view.state.doc
  if (at < 2 || at > doc.length || doc.sliceString(at - 2, at) !== '[[') return false
  const insert = `${text}]]`
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
    userEvent: 'input.link',
    scrollIntoView: true,
  })
  view.focus()
  return true
}
