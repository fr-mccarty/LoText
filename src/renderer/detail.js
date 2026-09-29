// THE DETAIL PANE — the editor, a viewer for a file the editor cannot open, or the empty state.
//
// **Nothing is drawn above the editor but a handle.** The top of the pane is a title-bar-high
// strip in the editor's own colour — no name, no rule, no hairline — that exists to be grabbed:
// the window drags from it, and with the sidebar hidden it is where the traffic lights sit. The
// text starts below it rather than scrolling underneath, so the strip is never also a line of
// text you meant to click. No tab bar and no file name: which file is open is said in two
// places already — the window's title, and the sidebar's highlight.
//
// The two **banners** are the one exception, and they are not chrome: each is a piece of news
// about the file under it — the folder has gone, the file has gone — and each goes away when it
// stops being true.

import { element, clear, icon, quote } from './dom.js'
import { buildViewer } from './viewers/viewer.js'

export class DetailPane {
  constructor (root, model) {
    this.root = root
    this.model = model
    this.dragStrip = element('div', { class: 'drag-strip' })
    this.bannerHost = element('div', { class: 'banners' })
    // The editor is built once and kept: a file opening is a new state inside the same view,
    // which is what lets the window survive every re-render with its scroll intact.
    this.editorHost = element('div', { class: 'editor-host' })
    this.overlayHost = element('div', { class: 'overlay-host' })
    this.root.append(this.dragStrip, this.bannerHost, this.editorHost, this.overlayHost)
  }

  render () {
    const model = this.model
    clear(this.bannerHost)

    if (model.folderIsUnavailable) {
      this.bannerHost.append(banner(
        `The folder ${quote(model.folder?.name ?? '')} is unavailable. Your text is still here.`,
        'warning'))
    }

    const file = model.openFile
    if (file?.state === 'missingOnDisk') {
      this.bannerHost.append(banner(
        `${quote(file.fileName)} is no longer on disk. Its text is still here; the next save asks where to put it.`,
        'question'))
    }

    // `previewPath` and `openFile` are never both set: a window holds an open file *or* a
    // previewed path, and each side clears the other as it takes over.
    if (model.previewPath) {
      this.editorHost.hidden = true
      this.overlayHost.hidden = false
      clear(this.overlayHost)
      this.overlayHost.append(
        buildViewer(model.previewPath, model.previewState, model.settings.view))
      return
    }

    if (!file) {
      this.editorHost.hidden = true
      this.overlayHost.hidden = false
      clear(this.overlayHost)
      // One symbol and one line, centred, in the secondary label colour. Nothing else: no
      // buttons, no recent-files list, no onboarding.
      this.overlayHost.append(element('div', { class: 'empty-state' }, [
        icon(model.hasFolder ? 'doc' : 'folder', 38),
        element('p', {
          text: model.hasFolder ? 'Select a file to start editing' : 'Open a folder to get started',
        }),
      ]))
      return
    }

    if (file.state === 'loading' || file.state === 'failed') {
      this.editorHost.hidden = true
      this.overlayHost.hidden = false
      clear(this.overlayHost)
      this.overlayHost.append(file.state === 'loading'
        ? element('div', { class: 'pane-message' }, [element('p', { text: 'Downloading…' })])
        : element('div', { class: 'pane-message' }, [icon('warning', 32), element('p', { text: file.failure })]))
      return
    }

    this.overlayHost.hidden = true
    clear(this.overlayHost)
    this.editorHost.hidden = false
  }
}

function banner (text, symbol) {
  return element('div', { class: 'banner detail-banner' }, [
    icon(symbol, 13),
    element('span', { text }),
  ])
}
