// The LoText editor for a web page: lolekproductions.org/LoText mounts it so people can try the
// app's own editing in the browser. It is the editor's real code — task boxes, enhanced tasks,
// disclosure arrows, the hanging indent for wrapped lines, Tab, Return keeping the indent, ⌥↑ / ⌥↓,
// ⌘X, ⌘[ / ⌘], and external links `[text](https://…)` (⌘-click opens a new tab; written
// backwards their brackets show red) — without the app around it: no files, no menus, no settings.
//
//   window.LoTextPlayground.mount(element, text)   → a function that takes the editor away again
//
// `npm run web:build` builds it into dist-web/, with playground.css beside it.

import { EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { taskBoxes } from '../renderer/editor/task-boxes.js'
import { enhancedTasks, moveItems, hideLines, showLines } from '../renderer/editor/enhanced-view.js'
import { hangingIndent } from '../renderer/editor/hanging-indent.js'
import { wikiLinks } from '../renderer/editor/wiki-links.js'
import { cutWholeLines, indentBy, outdentBy, insertNewlineKeepingIndent } from '../renderer/editor/line-editing.js'

const TAB_SPACES = 2

function mount (element, text) {
  const view = new EditorView({
    parent: element,
    state: EditorState.create({
      doc: text,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        hangingIndent,
        taskBoxes,
        enhancedTasks,
        // No files here, so no wiki links to follow: only `[text](address)`, in a new tab.
        wikiLinks({ onOpenAddress: (address) => window.open(address, '_blank', 'noopener') }),
        keymap.of([
          { key: 'Enter', run: insertNewlineKeepingIndent },
          { key: 'Tab', run: (target) => indentBy(target, TAB_SPACES), shift: (target) => outdentBy(target, TAB_SPACES) },
          { key: 'Alt-ArrowUp', run: (target) => moveItems(target, -1) },
          { key: 'Alt-ArrowDown', run: (target) => moveItems(target, 1) },
          { key: 'Mod-x', run: (target) => cutWholeLines(target) },
          // Always claimed, even with nothing to hide or show: in a browser ⌘[ and ⌘] are Back and Forward.
          { key: 'Mod-[', run: (target) => { hideLines(target); return true } },
          { key: 'Mod-]', run: (target) => { showLines(target); return true } },
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        EditorView.contentAttributes.of({
          spellcheck: 'false',
          autocorrect: 'off',
          autocapitalize: 'off',
          'aria-label': 'LoText editor',
        }),
      ],
    }),
  })
  return () => view.destroy()
}

window.LoTextPlayground = { mount }
