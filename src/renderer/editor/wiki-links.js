// Wiki links (`specs/wiki-links.md`): `[[notes/today.md]]`, a path relative to the folder the
// open file is in. Typing `[[` asks for a file under that folder — the app shows the Find File
// picker, narrowed to it — and the chosen path is written in and the brackets closed. ⌘-click on
// a link opens the file it names; while ⌘ is held over one, it shows a pointer. A finger has no
// ⌘, so on a touch screen a plain tap on a link opens it.
//
// `[[…]]` is the internal link. The external one is Markdown's `[text](https://…)`: the same
// click opens its address in the system's browser. Either written backwards — `]]…[[`,
// `(…)[…]` — has its brackets drawn red, so the slip shows while typing.
//
// The link is the text: nothing is hidden or redrawn, it is only marked so it can take a click.

import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import * as FilePath from '../../shared/file-path.js'
import { isWindows } from '../platform.js'

/** A link: `[[`, a target with no brackets and no line break, `]]`. */
const LINK = /\[\[([^[\]\n]+)\]\]/g

/** Every link on a line, left to right: { from, to, target }, columns in the line. */
export function linksOn (text) {
  return [...text.matchAll(LINK)].map((match) =>
    ({ from: match.index, to: match.index + match[0].length, target: match[1].trim() }))
}

/**
 * The address an external link opens, or null when it is no web or mail address: `https://…`,
 * `http://…` and `mailto:…` as written, `www.…` with `https://` put in front.
 */
export function webAddress (target) {
  const text = target.trim()
  if (/\s/.test(text)) return null
  if (/^(https?:\/\/[^/\s]|mailto:\S)/i.test(text)) return text
  if (/^www\.[^.\s]+\.\S/i.test(text)) return `https://${text}`
  return null
}

/** An external link: `[text](address)`, neither part empty or broken across a line. */
const WEB_LINK = /\[([^[\]\n]+)\]\(([^()\s]+)\)/g

/**
 * Every external link on a line, left to right: { from, to, address }, columns in the line.
 * Only a web or mail address makes one, and a `[` that is the second of a wiki link's `[[` starts
 * none.
 */
export function webLinksOn (text) {
  const found = []
  for (const match of text.matchAll(WEB_LINK)) {
    if (text[match.index - 1] === '[') continue
    const address = webAddress(match[2])
    if (address) found.push({ from: match.index, to: match.index + match[0].length, address })
  }
  return found
}

/**
 * Links written the wrong way round on a line — `]]target[[` and `(address)[text]` — as the
 * column ranges of their brackets, { from, to }, left to right. Brackets that belong to a real
 * wiki link never count, so the `]] and [[` between two links is not taken for one; and
 * `(…)[…]` needs words in both halves, so `( )[ ]` and the like stay plain.
 */
export function backwardsOn (text) {
  const taken = linksOn(text)
  const inLink = (column) => taken.some((link) => column >= link.from && column < link.to)
  const found = []
  for (const match of text.matchAll(/\]\]([^[\]\n]*)\[\[/g)) {
    const close = match.index
    const open = match.index + match[0].length - 2
    if (inLink(close) || inLink(open)) continue
    found.push({ from: close, to: close + 2 }, { from: open, to: open + 2 })
  }
  for (const match of text.matchAll(/\(([^()\n]*\S[^()\n]*)\)\[([^[\]\n]*[^[\]\s][^[\]\n]*)\]/g)) {
    const at = match.index
    const square = at + match[1].length + 2
    if (inLink(at) || inLink(square)) continue
    found.push({ from: at, to: at + 1 }, { from: square - 1, to: square + 1 }, { from: at + match[0].length - 1, to: at + match[0].length })
  }
  return found.sort((a, b) => a.from - b.from)
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
const webLinkMark = Decoration.mark({ class: 'lo-web-link' })
const backwardsMark = Decoration.mark({ class: 'lo-link-backwards' })

/** The visible lines' links, external links and backwards brackets, as marks. */
function linkMarks (view) {
  const ranges = []
  const doc = view.state.doc
  let lastLine = -1
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos)
      if (line.number > lastLine && /[\]\)]/.test(line.text)) {
        for (const link of linksOn(line.text)) ranges.push(linkMark.range(line.from + link.from, line.from + link.to))
        for (const link of webLinksOn(line.text)) ranges.push(webLinkMark.range(line.from + link.from, line.from + link.to))
        for (const bracket of backwardsOn(line.text)) ranges.push(backwardsMark.range(line.from + bracket.from, line.from + bracket.to))
      }
      lastLine = line.number
      pos = line.to + 1
    }
  }
  return Decoration.set(ranges, true)
}

const marks = ViewPlugin.fromClass(class {
  constructor (view) {
    this.decorations = linkMarks(view)
  }

  update (update) {
    if (update.docChanged || update.viewportChanged) this.decorations = linkMarks(update.view)
  }
}, { decorations: (plugin) => plugin.decorations })

/** The editor's class while ⌘ is down, so the links under the pointer show that they follow. */
function holdingFollowKey (view, held) {
  view.dom.classList.toggle('lo-follow-key', held)
}

/**
 * The link machinery. `onRequestLink(view, at)` is called after `[[` is typed, `at` just after
 * it; `onFollowLink(target)` with a wiki link's text when it is ⌘-clicked, and
 * `onOpenAddress(address)` with an external link's address.
 */
export function wikiLinks ({ onRequestLink, onFollowLink, onOpenAddress }) {
  // When a finger last touched the text. A tap arrives as a touch and then a mousedown; a
  // long-press or a scroll sends no mousedown, so selecting and scrolling over a link still work.
  let lastTouch = 0
  const events = EditorView.domEventHandlers({
    touchstart () { lastTouch = Date.now() },
    mousedown (event, view) {
      const tapped = Date.now() - lastTouch < TAP_WINDOW
      if (event.button !== 0) return false
      if (!tapped && (!followKey(event) || event.shiftKey || event.altKey)) return false
      const target = event.target instanceof Element ? event.target.closest('.lo-wiki-link, .lo-web-link') : null
      if (!target) return false
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos === null) return false
      const line = view.state.doc.lineAt(pos)
      const column = pos - line.from
      const under = (candidate) => column >= candidate.from && column < candidate.to
      const link = linksOn(line.text).find(under)
      const web = link ? null : webLinksOn(line.text).find(under)
      if (link?.target && onFollowLink) {
        event.preventDefault()
        onFollowLink?.(link.target)
        return true
      }
      if (web) {
        event.preventDefault()
        onOpenAddress?.(web.address)
        return true
      }
      return false
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

  // The web page's editor has no folder: it takes the external links and the red brackets only.
  return onRequestLink ? [marks, events, typing] : [marks, events]
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
