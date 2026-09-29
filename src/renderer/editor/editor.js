// The editor: one font, one size, every line alike.
//
// No page outline, no margins, no page breaks, no ruler, no zoom-to-fit. Print settings are
// invisible here. `# Heading` looks like any other line — hashes and all — because headings
// are a *printing* idea, and so are `**bold**`, `*italic*`, `` `code` `` and tables. You see
// the characters you typed.
//
// Smart quotes, smart dashes, autocorrect: all off. You typed it, you get it.
//
// CodeMirror is the foundation, and everything below is either configuration of it or one of
// the six commands this app adds. The find bar is CodeMirror's own — there is no search
// written here — and the five find menu items each hand it one action and get out of the way.

import { EditorState, EditorSelection, Compartment, Transaction } from '@codemirror/state'
import { EditorView, keymap, drawSelection, rectangularSelection,
  dropCursor } from '@codemirror/view'
import { selectionTrim } from './selection-trim.js'
import { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands'
import {
  searchKeymap, closeSearchPanel, findNext, findPrevious, selectNextOccurrence, setSearchQuery, SearchQuery, getSearchQuery,
} from '@codemirror/search'
import { invisibles } from './invisibles.js'
import { taskBoxes } from './task-boxes.js'
import { hangingIndent } from './hanging-indent.js'
import { findBar, showFindBar } from './find-bar.js'
import { enhancedTasks, moveItems, hideLines, showLines } from './enhanced-view.js'
import * as TextRanges from './text-ranges.js'
import { cutWholeLines, indentBy, outdentBy, linesOfSelection, insertNewlineKeepingIndent } from './line-editing.js'
import * as Emphasis from './emphasis-markers.js'
import { FONT_CHOICES } from '../../shared/print/fonts.js'
import { lineSpacingMultiple } from '../../shared/settings-shape.js'

const appearance = new Compartment()
const invisiblesCompartment = new Compartment()
/** Holds `history()`, so a reload can drop the undo entries of text that is gone. */
const historyCompartment = new Compartment()

export class Editor {
  /**
   * One view for the window, and a fresh state per file. Nothing carries across: the incoming
   * file gets its own buffer, cursor, scroll position and undo history, and the outgoing one's
   * are gone. That is the price of having no tabs, and it is paid deliberately.
   */
  constructor (parent, { onChange, onSelectionChange }) {
    this.onChange = onChange
    this.onSelectionChange = onSelectionChange
    this.isProgrammatic = false
    this.settings = null

    this.view = new EditorView({
      parent,
      state: this.makeState(''),
    })
  }

  makeState (text) {
    return EditorState.create({
      doc: text,
      extensions: [
        historyCompartment.of(history()),
        drawSelection(),
        selectionTrim,
        dropCursor(),
        rectangularSelection(),
        // Soft-wrap at the view width; no horizontal scrolling, and no page width to wrap to.
        EditorView.lineWrapping,
        hangingIndent,
        EditorState.allowMultipleSelections.of(true),
        findBar,
        appearance.of(this.appearanceTheme()),
        invisiblesCompartment.of(this.settings?.showInvisibles ? invisibles : []),
        taskBoxes,
        enhancedTasks,
        // The app's own keys live in the **menu**, so that the menu is the one place every
        // shortcut this app adds can be read off. What is bound here is only what the menu
        // does not claim: the ordinary editing keys, and the find panel's own.
        keymap.of([
          // Tab indents here rather than leaving for the sidebar. Esc then Tab still leaves.
          { key: 'Tab', run: (view) => indentBy(view, this.tabSpaces), shift: (view) => outdentBy(view, this.tabSpaces) },
          // Ahead of CodeMirror's own Return, which wrote a tab indent back as spaces.
          { key: 'Enter', run: insertNewlineKeepingIndent },
          // Ahead of CodeMirror's own ⌥↑ / ⌥↓, which move a line; ⇧⌥ still copies one.
          { key: 'Alt-ArrowUp', run: (view) => moveItems(view, -1) },
          { key: 'Alt-ArrowDown', run: (view) => moveItems(view, 1) },
          ...searchKeymap.filter((binding) => !CLAIMED_BY_MENU.has(binding.key)),
          ...historyKeymap.filter((binding) => !CLAIMED_BY_MENU.has(binding.key)),
          ...defaultKeymap.filter((binding) => !CLAIMED_BY_MENU.has(binding.key)),
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !this.isProgrammatic) this.onChange?.()
          if (update.selectionSet || update.docChanged) this.onSelectionChange?.()
        }),
        EditorView.contentAttributes.of({
          spellcheck: 'false',
          autocorrect: 'off',
          autocapitalize: 'off',
          'data-gramm': 'false',
        }),
      ],
    })
  }

  // MARK: - The buffer

  get text () {
    return this.view.state.doc.toString()
  }

  /** Loading a file. Notifies nobody, so the app layer can fill a buffer without dirtying it. */
  load (text) {
    this.isProgrammatic = true
    // The buffer the old undo entries described is gone, so replaying them would write text
    // that never existed. A fresh state drops them rather than registering an undo for the swap.
    this.view.setState(this.makeState(text))
    this.isProgrammatic = false
    if (this.settings) this.apply(this.settings)
  }

  /**
   * A silent external reload of a clean buffer: keeps the scroll position and the caret where
   * it can, notifies nobody, and leaves no undo entry behind.
   */
  reload (text) {
    const selection = this.view.state.selection.main.head
    const scroll = this.view.scrollDOM.scrollTop
    this.isProgrammatic = true
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: { anchor: Math.min(selection, text.length) },
      annotations: Transaction.addToHistory.of(false),
      // The undo entries, which describe the text before it, are dropped, as `load` drops them.
      // Replaying them over the new text would write text that never existed.
      effects: historyCompartment.reconfigure([]),
    })
    this.view.dispatch({ effects: historyCompartment.reconfigure(history()) })
    this.isProgrammatic = false
    this.view.scrollDOM.scrollTop = scroll
  }

  // MARK: - Where the file was left

  /**
   * What reopening the file puts back: the main selection, and the line at the top of the pane
   * (1-based). A line rather than a pixel offset, because the other device's window is not
   * this one's width.
   */
  position () {
    const { anchor, head } = this.view.state.selection.main
    const visibleTop = this.view.scrollDOM.getBoundingClientRect().top - this.view.documentTop
    const block = this.view.lineBlockAtHeight(Math.max(0, visibleTop))
    return { anchor, head, top: this.view.state.doc.lineAt(block.from).number }
  }

  /** After a load. The file may have changed since, so every number is clamped to what is here. */
  restorePosition (position) {
    if (!position) return
    const doc = this.view.state.doc
    const clampTo = (value) => Math.min(Math.max(0, Number(value) || 0), doc.length)
    const top = doc.line(Math.min(Math.max(1, Number(position.top) || 1), doc.lines)).from
    this.view.dispatch({
      selection: { anchor: clampTo(position.anchor), head: clampTo(position.head) },
      effects: EditorView.scrollIntoView(top, { y: 'start', yMargin: 0 }),
    })
  }

  focus () {
    this.view.focus()
  }

  /** How many spaces Tab puts in: the setting, 2 (the default) or 4. */
  get tabSpaces () {
    return this.settings?.tabSpaces ?? 2
  }

  get isFocused () {
    return this.view.hasFocus
  }

  destroy () {
    this.view.destroy()
  }

  // MARK: - View settings

  /**
   * The view font at the view size, the view line spacing, and the view invisibles — applied
   * uniformly to the whole buffer. Reflows immediately, keeping the selection and the line
   * that was at the top of the pane.
   */
  apply (settings) {
    this.settings = settings
    this.view.dispatch({
      effects: [
        appearance.reconfigure(this.appearanceTheme()),
        invisiblesCompartment.reconfigure(settings.showInvisibles ? invisibles : []),
      ],
    })
  }

  appearanceTheme () {
    const settings = this.settings
    const size = settings?.editorFontSize ?? 13
    const family = FONT_CHOICES[settings?.editorFont ?? 'systemMono'].css
    const spacing = lineSpacingMultiple(settings?.lineSpacing ?? 'single')
    return EditorView.theme({
      '&': { fontSize: `${size}px` },
      '.cm-content': {
        fontFamily: family,
        lineHeight: String(spacing * 1.45),
        // Breathing room on all four sides: text pinned to the pane's edge is hard to read and
        // harder to click into. Horizontal is the wider of the two, since that is the edge the
        // eye travels along. The top inset clears the title bar, under which nothing is drawn.
        padding: '16px 48px 40vh 48px',
      },
      '.cm-line': { padding: '0' },
    })
  }

  // MARK: - The selection, as ranges

  /** The sites the next edit applies to, in the shape the marker code speaks. */
  sites () {
    return this.view.state.selection.ranges
      .map((r) => TextRanges.range(Math.min(r.from, r.to), Math.abs(r.to - r.from)))
      .sort((a, b) => a.location - b.location)
  }

  select (ranges) {
    if (!ranges.length) return
    const merged = TextRanges.merged(ranges)
    this.view.dispatch({
      selection: EditorSelection.create(
        merged.map((item) => EditorSelection.range(item.location, item.location + item.length)),
        merged.length - 1),
      scrollIntoView: true,
    })
  }

  // MARK: - ⌘D, Select Next Instance

  /**
   * With nothing selected, selects the word the caret is in. With something selected, finds the
   * next occurrence of that text and adds it to the selection, wrapping at the end of the file
   * and stopping once every occurrence is selected. Typing then replaces all of them at once.
   */
  selectNextInstance () {
    selectNextOccurrence(this.view)
  }

  // MARK: - ⌘X, cut the line when nothing is selected

  /**
   * A selection cuts as usual. With only carets, the whole line each caret is on goes to the
   * clipboard and out of the buffer — two carets on one line cut it once. The line goes with
   * its newline, so it pastes back as a line, and cutting the last line of a file that has no
   * trailing newline leaves no blank line behind.
   *
   * Cut and delete-line share one shortcut rather than costing two, and cut is never taken away.
   */
  cut () {
    if (!cutWholeLines(this.view)) document.execCommand('cut')
  }

  // MARK: - ⌥↑ and ⌥↓, move the line

  /** A task or a closed disclosure moves whole; anything else a line at a time (`move-items.js`). */
  moveLinesUp () { moveItems(this.view, -1) }

  moveLinesDown () { moveItems(this.view, 1) }

  // MARK: - ⌘[ and ⌘], hide and show lines

  /** Closes the arrow around the caret, or hides the selected lines under the first (`enhanced-view.js`). */
  hideLines () { hideLines(this.view) }

  showLines () { showLines(this.view) }

  // MARK: - ⌘B and ⌘I, emphasis markers

  /**
   * Puts `**` or `*` around each selection site, or takes it away when it is already there.
   * Plain text in, plain text out: this is typing two characters in two places, not styling.
   * The screen does not change weight; the file gains two characters at each end; the *printer*
   * is what later reads them as bold.
   */
  toggleBold () { this.applyMarkers(Emphasis.editsFor(this.sites(), Emphasis.BOLD, this.text)) }

  toggleItalic () { this.applyMarkers(Emphasis.editsFor(this.sites(), Emphasis.ITALIC, this.text)) }

  /**
   * Applies a marker shortcut's edits as one undoable change and puts the selection on the text
   * it was on before.
   */
  applyMarkers ({ edits, selections }) {
    if (!edits.length) return
    this.view.dispatch({
      changes: edits.map((edit) => ({
        from: edit.range.location,
        to: TextRanges.maxRange(edit.range),
        insert: edit.replacement,
      })),
      selection: EditorSelection.create(
        selections.map((item) => EditorSelection.range(item.location, item.location + item.length)),
        selections.length - 1),
      // Its own undo step, never coalesced into the typing on either side of it: ⌘B then ⌘Z
      // takes the markers off and leaves the word that was typed before them alone.
      userEvent: 'input.markers',
      scrollIntoView: true,
    })
  }

  // MARK: - Undo

  undo () { undo(this.view) }

  redo () { redo(this.view) }

  // MARK: - The on-screen keyboard's bar (iOS)

  /** Tab and ⇧Tab, for a keyboard that has no Tab key. The same edits the key makes. */
  indent () { indentBy(this.view, this.tabSpaces) }

  outdent () { outdentBy(this.view, this.tabSpaces) }

  /**
   * A task box at the head of each line the selection touches, after its indentation — the
   * two keystrokes the on-screen keyboard buries under its symbols page. A line that already
   * opens with a box is left alone.
   */
  startTask () {
    const state = this.view.state
    const changes = []
    for (const line of linesOfSelection(state)) {
      const indent = /^ */.exec(line.text)[0].length
      if (/^\[[ xX]?\]/.test(line.text.slice(indent))) continue
      changes.push({ from: line.from + indent, insert: '[ ] ' })
    }
    if (changes.length) this.view.dispatch({ changes, userEvent: 'input.task', scrollIntoView: true })
  }

  /** Puts the on-screen keyboard away by taking the keyboard out of the buffer. */
  blur () { this.view.contentDOM.blur() }

  // MARK: - Cut and Send to DayCap

  /**
   * The selected text, every range of it joined by a newline, with the state it was read from:
   * null with nothing selected.
   */
  takeSelection () {
    const state = this.view.state
    const ranges = state.selection.ranges.filter((range) => !range.empty)
    if (!ranges.length) return null
    return { state, text: ranges.map((range) => state.sliceDoc(range.from, range.to)).join('\n') }
  }

  /**
   * Deletes what `takeSelection` read, as one edit that ⌘Z puts back, but only while the text
   * and the selection are still the ones it was read from. Answers whether it deleted.
   */
  removeTaken (taken) {
    const state = this.view.state
    if (state.doc !== taken.state.doc || !state.selection.eq(taken.state.selection)) return false
    this.view.dispatch(state.replaceSelection(''), { userEvent: 'delete.cut', scrollIntoView: true })
    return true
  }

  // MARK: - Find, over the open file

  /**
   * ⌘F, ⌥⌘F, ⌘G, ⇧⌘G and ⌘E, all of them one call into CodeMirror's own search — which is why
   * there is no search code in this app: the query, the wrap and the highlighting are all its.
   * Only the bar is ours (`find-bar.js`), drawn like AppKit's. ⇧⌘P is the other search, and a
   * different question entirely: that one matches file *names* under the opened folder.
   */
  find () {
    showFindBar(this.view)
  }

  /** The same bar with the replace row in hand. A replacement is written through the buffer,
   *  which is what makes undo and the unsaved-changes dot treat it exactly as they treat typing. */
  findAndReplace () {
    showFindBar(this.view, { replace: true })
  }

  findNext () { findNext(this.view) }

  findPrevious () { findPrevious(this.view) }

  /** Takes the selected text as the thing to look for, without opening the bar to type it. */
  useSelectionForFind () {
    const main = this.view.state.selection.main
    if (main.empty) return
    const search = this.view.state.sliceDoc(main.from, main.to)
    const current = getSearchQuery(this.view.state)
    this.view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({
        search,
        caseSensitive: current.caseSensitive,
        regexp: false,
        replace: current.replace,
      })),
    })
  }

  closeFind () { closeSearchPanel(this.view) }

  /** ⌘⌫ with the caret in the buffer is the platform's delete-to-beginning-of-line. */
  deleteToLineStart () {
    const state = this.view.state
    this.view.dispatch(state.changeByRange((range) => {
      const line = state.doc.lineAt(range.head)
      const from = Math.min(line.from, range.head)
      return {
        changes: { from, to: range.head, insert: '' },
        range: EditorSelection.cursor(from),
      }
    }), { userEvent: 'delete.backward' })
  }
}

/**
 * The keys the **menu** owns. CodeMirror must not also bind them, or a menu item and a keymap
 * would each do half the job and the menu would stop being the place every shortcut can be read
 * off. Everything not on this list stays CodeMirror's.
 *
 * ⌥↑ and ⌥↓ are deliberately *not* here: the menu shows them but cannot receive them (see
 * `menu.js`), so the editor's own `Alt-ArrowUp` / `Alt-ArrowDown` binding does the work.
 *
 * `Mod-/` is here although no menu item uses it: this app has no comment command, and without
 * the entry CodeMirror's default keymap would quietly bring its own back.
 */

const CLAIMED_BY_MENU = new Set([
  'Mod-f', 'Mod-Alt-f', 'Mod-g', 'Shift-Mod-g', 'Mod-e',
  'Mod-d', 'Mod-b', 'Mod-i', 'Mod-/', 'Mod-z', 'Shift-Mod-z', 'Mod-y',
  'Mod-Backspace', 'Mod-[', 'Mod-]',
])
