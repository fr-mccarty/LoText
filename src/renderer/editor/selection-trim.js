// Selection that stops at the text.
//
// CodeMirror draws a fully selected row to the full width of the editor, the way a browser
// selects a block element: `rectanglesForRange` takes its right edge from the content box, not
// from where the line's characters end. In a wide window a selected paragraph becomes a slab of
// colour reaching the far edge, which is not what the app this one is matched to does —
// NSTextView ends the highlight just past the last character, with a small tail standing in for
// the newline.
//
// The rectangles stay CodeMirror's. This trims the ones that run to the edge, splits the one it
// draws for the *middle* of a multi-line selection — a single tall block covering every row
// between the first and the last — into one rectangle per row, because each row's text ends
// somewhere different and a block has only one width, and pulls every rectangle's left edge in
// to where the text starts, since CodeMirror measures from the content box and so fills the
// editor's left padding with colour before the first character.

import { ViewPlugin } from '@codemirror/view'

/** How far past the last glyph the highlight goes: enough to show the newline is in it. */
const TAIL = 7

/** Within this of the content's right edge counts as "drawn to the edge" rather than to text. */
const EDGE_SLOP = 2

/** Marks the rectangles this adds, so a re-run clears its own work and not CodeMirror's. */
const SPLIT = 'data-lo-split'

export const selectionTrim = ViewPlugin.fromClass(class {
  constructor (view) {
    this.view = view

    // Two measure passes, because one cannot work. The selection layer **replaces its
    // children** when it writes, so anything found in the first pass's read is detached by the
    // time the write runs and the new widths land on nothing. Doing the work in the write
    // instead throws — CodeMirror forbids reading layout during an update, and finding where a
    // row's text ends is a layout read.
    //
    // So the first pass does nothing but ask for a second one. By then the layer has drawn, its
    // children are the nodes actually on screen, and a read phase is allowed to measure them.
    this.secondPass = {
      read: (view) => this.plan(view),
      write: (plan) => this.apply(plan),
    }
    this.firstPass = {
      read: () => null,
      write: (_measure, view) => view.requestMeasure(this.secondPass),
    }

    this.schedule()
  }

  update (update) {
    if (update.selectionSet || update.docChanged ||
        update.viewportChanged || update.geometryChanged) {
      this.schedule()
    }
  }

  schedule () {
    this.view.requestMeasure(this.firstPass)
  }

  /** For every rectangle that reaches the edge, the rows it covers and how wide each should be. */
  plan (view) {
    const layer = view.scrollDOM.querySelector('.cm-selectionLayer')
    if (!layer) return null

    const contentRight = view.contentDOM.getBoundingClientRect().right
    const padLeft = parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0
    const lineHeight = view.defaultLineHeight
    const plan = []

    for (const node of Array.from(layer.children)) {
      if (node.hasAttribute(SPLIT)) continue
      const rect = node.getBoundingClientRect()
      if (rect.width === 0) continue
      const reachesEdge = rect.right >= contentRight - EDGE_SLOP

      // `style.left` is in the layer's coordinates and the measurements are in the viewport's,
      // so the difference between them is what converts one to the other.
      const left = parseFloat(node.style.left || '0')
      const originX = rect.left - left
      const top = parseFloat(node.style.top || '0')
      const rows = reachesEdge ? Math.max(1, Math.round(rect.height / lineHeight)) : 1
      const rowHeight = rect.height / rows

      // The right edge comes from the text on each row; the left is pulled in to where the
      // text starts. An empty row keeps a sliver, the way a selected blank line still shows.
      const clampedLeft = Math.max(left, padLeft)
      const widths = []
      for (let row = 0; row < rows; row++) {
        const y = rect.top + rowHeight * (row + 0.5)
        const right = reachesEdge
          ? this.textWidth(view, contentRight, y, originX, left) ?? rect.width
          : rect.width
        widths.push(Math.max(TAIL, left + right - clampedLeft))
      }
      plan.push({ node, left: clampedLeft, top, rows, rowHeight, widths })
    }
    return plan
  }

  /** How wide a rectangle starting at `left` must be to end just past the text on this row. */
  textWidth (view, contentRight, y, originX, left) {
    const end = view.posAtCoords({ x: contentRight - 1, y })
    if (end == null) return null
    const coords = view.coordsAtPos(end, -1)
    if (!coords) return null
    const width = coords.right + TAIL - originX - left
    return width > 0 ? width : null
  }

  apply (plan) {
    if (!plan) return
    for (const { node, left, top, rows, rowHeight, widths } of plan) {
      // The first row keeps CodeMirror's own element; the rest are copies of it, which is what
      // keeps them in the layer's stacking and picking up its class.
      node.style.left = `${left}px`
      node.style.width = `${widths[0]}px`
      if (rows > 1) node.style.height = `${rowHeight}px`

      for (let row = 1; row < rows; row++) {
        const copy = node.cloneNode(false)
        copy.setAttribute(SPLIT, '')
        copy.style.left = `${left}px`
        copy.style.top = `${top + rowHeight * row}px`
        copy.style.height = `${rowHeight}px`
        copy.style.width = `${widths[row]}px`
        node.parentNode.appendChild(copy)
      }
    }
  }
})
