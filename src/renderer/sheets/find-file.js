// ⇧⌘P — quick-open: a field, and the files under the opened folder whose *paths* match what is
// typed in it, best first.
//
// It reads no file's contents — that is ⌘F's job, over the one file that is open — and there is
// still nothing anywhere that searches the text of a folder.
//
// **The keyboard is the whole of it.** The field has focus the instant the sheet appears; ↑ and
// ↓ move the highlight, clamped at both ends rather than wrapping, without the hands leaving
// the letters; ↩ opens; Esc closes and changes nothing. The sheet goes away the moment a file
// is chosen and does not wait for the open to finish.
//
// The same sheet picks a wiki link's file (`specs/wiki-links.md`): narrowed to the folder the open
// file is in and the folders under it, listing paths from there, and handing the choice back
// instead of opening it.

import { element, clear, icon } from '../dom.js'
import { makeCandidate, makeQuery, matches } from '../fuzzy.js'
import * as FilePath from '../../shared/file-path.js'

/** Quick-open is a keyboard tool — nobody scrolls to the four hundredth match. */
const ROW_LIMIT = 200

export class FindFileSheet {
  /**
   * `under`: only the files beneath this folder, listed by their path from it. `onChoose`: what
   * a choice does, given the file's full path; opening it, unless said otherwise.
   */
  constructor (model, { under = null, onChoose = null } = {}) {
    this.model = model
    this.under = under
    this.onChoose = onChoose
    this.candidates = []
    this.results = []
    this.highlighted = 0
    this.isWalking = false
    this.isTruncated = false
    this.total = 0
    this.token = 0
    this.query = ''
  }

  build () {
    this.field = element('input', {
      class: 'sheet-field',
      type: 'text',
      placeholder: this.onChoose ? 'Link to a file' : 'Find a file',
      spellcheck: 'false',
      oninput: () => { this.query = this.field.value; this.rank() },
      onkeydown: (event) => this.onKeyDown(event),
    })
    this.listNode = element('div', { class: 'sheet-list' })
    this.statusNode = element('div', { class: 'sheet-status' })

    this.node = element('div', { class: 'sheet find-file' }, [
      element('div', { class: 'sheet-eyebrow', text: this.eyebrow() }),
      element('div', { class: 'sheet-field-row' }, [icon('search', 15), this.field]),
      element('div', { class: 'sheet-divider' }),
      this.listNode,
      element('div', { class: 'sheet-divider' }),
      this.statusNode,
    ])

    // Focus first, then walk: the walk is awaited and the field must be typeable before it
    // finishes, not after.
    requestAnimationFrame(() => this.field.focus())
    this.startWalk()
    return this.node
  }

  /**
   * The folder is walked when the sheet opens and the walk is dropped when it closes, so a
   * second ⇧⌘P walks again. That is the trade, and it is the right way round.
   */
  startWalk () {
    this.token += 1
    const token = this.token
    this.candidates = []
    this.results = []
    this.total = 0
    this.isTruncated = false
    this.isWalking = true
    this.render()

    this.offBatch?.()
    this.offDone?.()
    this.offBatch = this.model.bridge.onSearchBatch((batch) => {
      if (batch.token !== token) return
      for (const path of batch.files) {
        const candidate = this.candidateFor(path)
        if (candidate) this.candidates.push(candidate)
      }
      this.total = this.candidates.length
      this.isTruncated = batch.truncated
      this.rank()
    })
    this.offDone = this.model.bridge.onSearchDone((done) => {
      if (done.token !== token) return
      this.isWalking = false
      this.render()
    })
    this.model.bridge.startWalk(token).catch(() => { this.isWalking = false; this.render() })
  }

  eyebrow () {
    if (!this.onChoose) return 'Find File'
    return FilePath.isRoot(this.under ?? '') ? 'Link to File' : `Link to File in ${FilePath.name(this.under)}`
  }

  /**
   * A walked file as a row, or null for one outside the folder the sheet is narrowed to. A
   * narrowed row is matched and shown by its path from that folder; `full` is what is chosen.
   */
  candidateFor (path) {
    if (this.under === null || FilePath.isRoot(this.under)) return { ...makeCandidate(path), full: path }
    if (!FilePath.isDescendant(path, this.under)) return null
    const relative = FilePath.components(path).slice(FilePath.components(this.under).length).join('/')
    return { ...makeCandidate(relative), full: path }
  }

  dispose () {
    this.offBatch?.()
    this.offDone?.()
    this.model.bridge.cancelWalk().catch(() => {})
  }

  rank () {
    this.results = matches(this.candidates, makeQuery(this.query), ROW_LIMIT)
    this.highlighted = Math.min(this.highlighted, Math.max(0, this.results.length - 1))
    this.render()
  }

  onKeyDown (event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.move(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.move(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      this.openHighlighted()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      this.model.closeSheet()
    }
  }

  move (delta) {
    if (!this.results.length) return
    this.highlighted = Math.min(Math.max(0, this.highlighted + delta), this.results.length - 1)
    this.render()
  }

  openHighlighted () {
    const candidate = this.results[this.highlighted]
    if (!candidate) return
    if (this.onChoose) { this.onChoose(candidate.full); return }
    this.model.closeSheet()
    this.model.openPath(candidate.full)
  }

  render () {
    if (!this.node) return
    clear(this.listNode)
    this.results.forEach((candidate, index) => {
      const row = element('div', {
        class: `sheet-row${index === this.highlighted ? ' highlighted' : ''}`,
        onmousedown: (event) => {
          event.preventDefault()
          this.highlighted = index
          this.openHighlighted()
        },
      }, [
        icon('doc', 14),
        element('div', { class: 'sheet-row-text' }, [
          element('div', { class: 'sheet-row-name', text: candidate.name }),
          // The folders above the file, truncated at the *head*, because the end of a long
          // path is the part that tells two files called `index.md` apart.
          candidate.folder
            ? element('div', { class: 'sheet-row-folder', text: candidate.folder })
            : null,
        ]),
      ])
      this.listNode.append(row)
      if (index === this.highlighted) {
        requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest' }))
      }
    })

    if (!this.results.length) {
      this.listNode.append(element('div', { class: 'sheet-empty', text: this.emptyMessage() }))
    }
    this.statusNode.textContent = this.statusMessage()
  }

  statusMessage () {
    if (!this.model.hasFolder) return 'No folder is open.'
    const total = this.total.toLocaleString()
    // Said plainly rather than left to be inferred from a list that stops: a file that is
    // genuinely there and not listed is the one thing a search must never imply.
    if (this.isTruncated) {
      return `This folder is too large to search whole — the first ${total} files are listed.`
    }
    if (this.isWalking) return `Reading the folder… ${total} files so far.`
    if (!this.query) return `${total} files.`
    return `${this.results.length.toLocaleString()} of ${total} files.`
  }

  emptyMessage () {
    if (!this.model.hasFolder) return 'Open a folder first.'
    if (this.isWalking) return 'Reading the folder…'
    if (!this.query) return 'This folder has no files to open.'
    return `No file matches “${this.query}”.`
  }
}
