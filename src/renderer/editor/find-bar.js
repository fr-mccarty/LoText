// The find bar over the open file, drawn to look like the one Lolext gets from AppKit
// (`NSTextView.usesFindBar`) and in the app's own colours: one field with its options behind the
// magnifier and the match count inside it, ‹ › to step, Done, and a Replace box that shows a
// second row. Only the bar is ours. The query, the matching, the highlighting, the wrap and the
// replacing are all CodeMirror's search, which this hands its panel to (`search({ createPanel })`).

import {
  SearchQuery, setSearchQuery, getSearchQuery, findNext, findPrevious, replaceNext, replaceAll,
  closeSearchPanel, openSearchPanel, search,
} from '@codemirror/search'
import { runScopeHandlers } from '@codemirror/view'
import { element, icon } from '../dom.js'

/** Past this many the count stops counting: "1000+ matches" says as much as the exact number. */
const COUNT_LIMIT = 1000

/** The bar of each view, so ⌘F and ⌥⌘F can say which row they want. */
const bars = new WeakMap()

/**
 * What the field's count says: "2 of 5" when the selection is a match, "5 matches" when it is
 * not, "Not found" for none. Empty with nothing to look for.
 */
export function countLabel ({ total, current, capped }) {
  if (total === 0) return 'Not found'
  if (capped) return `${COUNT_LIMIT}+ matches`
  if (current) return `${current} of ${total}`
  return total === 1 ? '1 match' : `${total} matches`
}

function countMatches (state, query) {
  const { from, to } = state.selection.main
  const cursor = query.getCursor(state)
  let total = 0
  let current = 0
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total++
    if (next.value.from === from && next.value.to === to) current = total
    if (total >= COUNT_LIMIT) return { total, current, capped: true }
  }
  return { total, current, capped: false }
}

class FindBar {
  constructor (view) {
    this.view = view
    this.query = getSearchQuery(view.state)
    bars.set(view, this)

    const quiet = { autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', autocomplete: 'off' }
    this.searchField = element('input', {
      class: 'lo-find-input', type: 'text', placeholder: 'Find', 'aria-label': 'Find', 'main-field': 'true',
      ...quiet, oninput: () => this.commit(),
    })
    this.replaceField = element('input', {
      class: 'lo-find-input', type: 'text', placeholder: 'Replace', 'aria-label': 'Replace',
      ...quiet, oninput: () => this.commit(),
    })
    this.count = element('span', { class: 'lo-find-count' })
    this.clearButton = element('button', {
      class: 'lo-find-clear', type: 'button', tabindex: '-1', 'aria-label': 'Clear',
      onmousedown: (event) => event.preventDefault(),
      onclick: () => { this.searchField.value = ''; this.commit(); this.searchField.focus() },
    }, [icon('clear', 13)])
    this.optionsButton = element('button', {
      class: 'lo-find-options', type: 'button', tabindex: '-1', 'aria-label': 'Search options',
      onmousedown: (event) => { event.preventDefault(); this.toggleOptions() },
    }, [icon('search', 13), icon('chevronDown', 9)])

    const step = (label, iconName, run) => element('button', {
      class: 'lo-find-step', type: 'button', tabindex: '-1', 'aria-label': label, title: label,
      onmousedown: (event) => event.preventDefault(),
      onclick: () => run(view),
    }, [icon(iconName, 12)])
    const push = (label, run, extra = {}) => element('button', {
      class: 'lo-find-button', type: 'button', tabindex: '-1', text: label,
      onmousedown: (event) => event.preventDefault(),
      onclick: run, ...extra,
    })

    this.replaceToggle = element('input', {
      type: 'checkbox', tabindex: '-1', onchange: () => this.setReplacing(this.replaceToggle.checked, true),
    })
    this.replaceRow = element('div', { class: 'lo-find-row lo-find-replace-row' }, [
      element('div', { class: 'lo-find-field' }, [this.replaceField]),
      element('div', { class: 'lo-find-trailing' }, [
        push('Replace', () => replaceNext(view)),
        push('All', () => replaceAll(view)),
      ]),
    ])

    this.dom = element('div', { class: 'lo-find', onkeydown: (event) => this.keydown(event) }, [
      element('div', { class: 'lo-find-row' }, [
        element('div', { class: 'lo-find-field' }, [this.optionsButton, this.searchField, this.count, this.clearButton]),
        element('div', { class: 'lo-find-trailing' }, [
          element('div', { class: 'lo-find-segmented' }, [
            step('Previous', 'chevronLeft', findPrevious),
            step('Next', 'chevron', findNext),
          ]),
          push('Done', () => closeSearchPanel(view)),
          element('label', { class: 'lo-find-toggle' }, [this.replaceToggle, 'Replace']),
        ]),
      ]),
      this.replaceRow,
    ])

    this.setQuery(this.query)
    this.setReplacing(false)
  }

  get top () { return true }

  mount () {
    this.searchField.focus()
    this.searchField.select()
  }

  destroy () {
    this.closeOptions()
    bars.delete(this.view)
  }

  update (update) {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) this.setQuery(effect.value)
      }
    }
    if (update.docChanged || update.selectionSet || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)))) {
      this.refreshCount()
    }
  }

  /** The replace row shown or not; `focus` puts the keyboard in the field that just appeared. */
  setReplacing (on, focus = false) {
    this.replacing = on && !this.view.state.readOnly
    this.replaceToggle.checked = this.replacing
    this.replaceRow.hidden = !this.replacing
    this.view.requestMeasure()
    if (focus) (this.replacing ? this.replaceField : this.searchField).focus()
  }

  setQuery (query) {
    this.query = query
    this.searchField.value = query.search
    this.replaceField.value = query.replace
    this.refreshCount()
  }

  commit (changes = {}) {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.query.caseSensitive,
      regexp: this.query.regexp,
      wholeWord: this.query.wholeWord,
      replace: this.replaceField.value,
      ...changes,
    })
    if (!query.eq(this.query)) {
      this.query = query
      this.view.dispatch({ effects: setSearchQuery.of(query) })
    }
    this.refreshCount()
  }

  refreshCount () {
    const empty = this.searchField.value === ''
    this.clearButton.hidden = empty
    if (empty) { this.count.textContent = ''; return }
    this.count.textContent = this.query.valid
      ? countLabel(countMatches(this.view.state, this.query))
      : 'Not a valid pattern'
  }

  keydown (event) {
    if (runScopeHandlers(this.view, event, 'search-panel')) {
      event.preventDefault()
    } else if (event.key === 'Enter' && event.target === this.searchField) {
      event.preventDefault()
      ;(event.shiftKey ? findPrevious : findNext)(this.view)
    } else if (event.key === 'Enter' && event.target === this.replaceField) {
      event.preventDefault()
      replaceNext(this.view)
    }
  }

  // MARK: - The magnifier's menu

  toggleOptions () {
    if (this.menu) { this.closeOptions(); return }
    const option = (label, checked, changes) => element('div', {
      class: 'menu-item lo-find-option',
      onmousedown: (event) => {
        event.preventDefault()
        this.closeOptions()
        this.commit(changes)
      },
    }, [element('span', { class: 'lo-find-check', text: checked ? '✓' : '' }), label])
    const query = this.query
    this.menu = element('div', { class: 'context-menu lo-find-menu' }, [
      option('Ignore Case', !query.caseSensitive, { caseSensitive: !query.caseSensitive }),
      option('Full Word', query.wholeWord, { wholeWord: !query.wholeWord }),
      element('div', { class: 'menu-separator' }),
      option('Regular Expression', query.regexp, { regexp: !query.regexp }),
    ])
    document.body.append(this.menu)
    const anchor = this.optionsButton.getBoundingClientRect()
    this.menu.style.left = `${Math.min(anchor.left, window.innerWidth - this.menu.offsetWidth - 8)}px`
    this.menu.style.top = `${anchor.bottom + 4}px`
    this.dismiss = (event) => { if (!this.menu?.contains(event.target)) this.closeOptions() }
    setTimeout(() => document.addEventListener('mousedown', this.dismiss), 0)
  }

  closeOptions () {
    this.menu?.remove()
    this.menu = null
    if (this.dismiss) document.removeEventListener('mousedown', this.dismiss)
    this.dismiss = null
  }
}

/** CodeMirror's search, with this bar as its panel. */
export const findBar = search({ top: true, createPanel: (view) => new FindBar(view) })

/**
 * ⌘F opens the bar with the find row alone, ⌥⌘F with the replace row too, as AppKit's
 * Find and Find and Replace do. The keyboard goes to the field for the row asked for.
 */
export function showFindBar (view, { replace = false } = {}) {
  openSearchPanel(view)
  const bar = bars.get(view)
  if (!bar) return
  bar.setReplacing(replace)
  const field = replace ? bar.replaceField : bar.searchField
  requestAnimationFrame(() => { field.focus(); field.select() })
}
