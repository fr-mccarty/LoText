// VIEWERS — read-only panes, for the files the editor will not take.
//
// This is not a preview of anything and not a second editor: a viewer shows a file, and nothing
// in it can change a byte of one. Which viewer is decided from the **name**, which is the other
// half of the list that decides what the sidebar dims.
//
//   image        .png .jpg .heic …    at its own size, or shrunk to fit — never enlarged past
//                                     1:1, because a sixteen-point icon stretched across a
//                                     window is a wall of fat pixels
//   media        .mp3 .mov …          and they *play*. A file with no picture in it gets its
//                                     name and a transport bar, because a video surface with
//                                     nothing on it is a black rectangle with nothing to click
//   pdf          .pdf                 scrolled continuously, with the page navigation and the
//                                     text selection that come with it
//   document     .docx .rtf .odt      the words, as PLAIN text, **selectable**, so ⌘A and ⌘C
//                                     get them out. Editor's font, editor's backdrop, no
//                                     formatting — this app has no WYSIWYG anywhere, and that
//                                     pane is not where it starts
//   rendered     .xlsx .pptx .pages…  the ones where the *layout* is the document: a grid for a
//                                     spreadsheet, the deck's own words for a presentation, and
//                                     for iWork the preview its own app drew
//
// A viewer's failures are sentences, and deliberately the editor's own. Nothing ever fails to a
// blank pane, which would be indistinguishable from an empty document rendered perfectly.

import { element, icon } from '../dom.js'
import { isAudioOnly, viewerFor } from '../../shared/binary-types.js'
import * as FilePath from '../../shared/file-path.js'
import { lineSpacingMultiple } from '../../shared/settings-shape.js'
import { FONT_CHOICES } from '../../shared/print/fonts.js'

export function buildViewer (path, state, view) {
  if (!state || state.status === 'loading') {
    return message('Downloading…', null, 'loading')
  }
  if (state.status === 'failed') {
    return message(state.message, 'warning', 'failed')
  }

  const name = FilePath.name(path)
  switch (state.viewer ?? viewerFor(name)) {
    case 'image': return imagePane(state.payload)
    case 'media': return mediaPane(name, state.payload)
    case 'pdf': return pdfPane(path, state.payload)
    default: return documentPane(name, state.payload, view)
  }
}

function message (text, symbol, id) {
  return element('div', { class: 'pane-message', dataset: { id } }, [
    symbol ? icon(symbol, 32) : null,
    element('p', { text }),
  ])
}

/** Larger than the pane it scrolls; smaller, it sits in the middle. Never blown up past 1:1. */
function imagePane (payload) {
  return element('div', { class: 'viewer image-viewer' }, [
    element('img', { src: payload.dataURL, alt: '' }),
  ])
}

function mediaPane (name, payload) {
  // iOS hands over a URL its web view can already play; the Mac, a path on disk.
  const source = payload.url ?? (payload.path ? `file://${encodeURI(payload.path)}` : payload.dataURL)
  if (isAudioOnly(name)) {
    return element('div', { class: 'viewer audio-viewer' }, [
      element('div', { class: 'audio-name', text: name }),
      element('audio', { src: source, controls: true }),
    ])
  }
  return element('div', { class: 'viewer media-viewer' }, [
    element('video', { src: source, controls: true, playsinline: true }),
  ])
}

function pdfPane (path, payload) {
  // WebKit on iOS draws only a PDF's first page in the pane, so there the pane offers Quick
  // Look instead, which pages, zooms and shares it. The button says so rather than doing it
  // unasked: a tap on a row opens things in the pane everywhere else.
  if (payload.quickLook) {
    return element('div', { class: 'pane-message', dataset: { id: 'pdf' } }, [
      icon('doc', 32),
      element('p', { text: FilePath.name(path) }),
      element('button', {
        class: 'text-button quick-look',
        text: 'Open in Quick Look',
        onclick: (event) => event.target.dispatchEvent(
          new CustomEvent('lotext:quicklook', { bubbles: true, detail: path })),
      }),
    ])
  }
  return element('div', { class: 'viewer pdf-viewer' }, [
    element('embed', { src: payload.dataURL, type: 'application/pdf' }),
  ])
}

/**
 * The words, and nothing else. It sits on the pane's own backdrop, exactly as the editor does,
 * so there is no lit white slab in the middle of a dark window — and dropping the document's
 * own colours is what removes the need for one.
 */
function documentPane (name, payload, view) {
  if (payload.kind === 'table') return sheetPane(payload, view)
  const node = element('pre', {
    class: 'viewer document-viewer',
    text: payload.text,
    // The editor's own font, size and line spacing, and it follows Settings when those change.
    style: {
      fontFamily: FONT_CHOICES[view.editorFont].css,
      fontSize: `${view.editorFontSize}px`,
      lineHeight: String(lineSpacingMultiple(view.lineSpacing) * 1.45),
    },
  })
  node.tabIndex = 0
  return node
}

function sheetPane (payload, view) {
  const container = element('div', { class: 'viewer sheet-viewer' })
  for (const sheet of payload.sheets) {
    const table = element('table')
    sheet.rows.forEach((row, index) => {
      const line = element('tr')
      for (const cell of row) {
        line.append(element(index === 0 ? 'th' : 'td', { text: cell }))
      }
      table.append(line)
    })
    container.append(element('div', { class: 'sheet-name', text: sheet.name }), table)
  }
  container.style.fontSize = `${view.editorFontSize}px`
  container.style.fontFamily = FONT_CHOICES[view.editorFont].css
  return container
}
