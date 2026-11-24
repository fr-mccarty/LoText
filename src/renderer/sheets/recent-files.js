// ⇧⌘O — the files under the folder changed most recently, newest first by the modified date on
// disk, with the one in front of the user left out of the list. Files made, saved here, or
// changed in another app or on the server all count, and the list survives a relaunch.
//
// Where ⇧⌘P answers "where is the file called this?", this answers "take me back to what I was
// just working on". Both walk the whole folder when the sheet opens (src/shared/store/recent.js).
//
// **The top row is the last file edited**, because the file on screen is not somewhere to go
// back to. That is what makes ⇧⌘O ↩ the whole gesture for "back". There is nothing to type: a
// list of twenty is read by eye, and the sheet says so along its bottom edge, because a list of
// rows with no field in it does not otherwise announce that it is a keyboard tool.

import * as FilePath from '../../shared/file-path.js'
import { element, clear, icon } from '../dom.js'

export class RecentFilesSheet {
  constructor (model) {
    this.model = model
  }

  build () {
    this.listNode = element('div', { class: 'sheet-list' })
    this.node = element('div', { class: 'sheet recent-files', tabindex: '0' }, [
      element('div', { class: 'sheet-eyebrow', text: 'Recently Edited' }),
      this.listNode,
      element('div', { class: 'sheet-divider' }),
      element('div', { class: 'sheet-status', text: '↑ ↓ to move · ↩ to open · esc to close' }),
    ])
    this.node.addEventListener('keydown', (event) => this.onKeyDown(event))
    requestAnimationFrame(() => this.node.focus())
    this.render()
    return this.node
  }

  dispose () {
    this.model.bridge.cancelRecentlyEdited().catch(() => {})
  }

  onKeyDown (event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); this.model.moveRecentHighlight(1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); this.model.moveRecentHighlight(-1) }
    else if (event.key === 'Enter') { event.preventDefault(); this.model.openHighlightedRecentFile() }
    else if (event.key === 'Escape') { event.preventDefault(); this.model.closeSheet() }
  }

  render () {
    if (!this.node) return
    const choices = this.model.recentFileChoices()
    clear(this.listNode)
    choices.forEach((path, index) => {
      const folder = FilePath.parent(path) ?? ''
      const row = element('div', {
        class: `sheet-row${index === this.model.recentHighlight ? ' highlighted' : ''}`,
        onmousedown: (event) => {
          event.preventDefault()
          this.model.recentHighlight = index
          this.model.openHighlightedRecentFile()
        },
      }, [
        icon('clock', 14),
        element('div', { class: 'sheet-row-text' }, [
          element('div', { class: 'sheet-row-name', text: FilePath.name(path) }),
          folder ? element('div', { class: 'sheet-row-folder', text: folder }) : null,
        ]),
      ])
      this.listNode.append(row)
      if (index === this.model.recentHighlight) {
        requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest' }))
      }
    })
    if (!choices.length) {
      let text = 'No other file in this folder.'
      if (!this.model.hasFolder) text = 'Open a folder first.'
      else if (this.model.recentFiles === null) text = 'Reading the folder…'
      this.listNode.append(element('div', { class: 'sheet-empty', text }))
    }
  }
}
