// ⌘P on iOS. The pages are laid out and drawn by exactly the code the Mac uses
// (src/main/print/print-window.js, in print.html), in a frame nobody sees; the drawn pages are
// then handed to the native side as one HTML document, which turns each page into a PDF page and
// gives the PDF to AirPrint — or, for Share PDF…, to the share sheet.
//
// The pages are drawn in points. The native side renders them at one point per pixel (see
// `ONE_POINT_PER_PIXEL`), so a page's rectangle in the web view is its size on paper and the PDF
// comes out at the paper's own size.

import { PAPER_SIZES } from '../shared/settings-shape.js'
import { Capacitor } from '@capacitor/core'
import { Native } from './native.js'

/**
 * iOS turns each page's rectangle into a PDF page itself, at one point per pixel. Android hands
 * the document to its print dialog, which pages it by the @page rule the Mac uses as well — so
 * there the page size stays and the zoom does not.
 */
const PAGED_BY_THE_SYSTEM = Capacitor.getPlatform() === 'android'

/** CSS points are 4/3 of a pixel; zooming the page to ¾ makes one point exactly one pixel. */
const ONE_POINT_PER_PIXEL = 'html { zoom: 0.75; }'

/**
 * @param job  `{ text, fileName, folderName, settings, paper }`, as the Mac's printer takes it:
 *             `settings` is the preset's snapshot, `paper` its paper name.
 * @param share  true for Share PDF…, false for Print…
 */
export async function printDocument (job, { share = false } = {}) {
  const size = PAPER_SIZES[job.paper] ?? PAPER_SIZES.letter
  const { html, pageCount } = await drawPages(job, size)
  const base = job.fileName.replace(/\.[^.]*$/, '') || job.fileName
  return Native.print({
    html,
    pageWidth: size.width,
    pageHeight: size.height,
    pageCount,
    jobName: base,
    share,
  })
}

async function drawPages (job, size) {
  const frame = document.createElement('iframe')
  frame.className = 'print-frame'
  frame.setAttribute('aria-hidden', 'true')
  frame.src = 'print.html'
  const loaded = new Promise((resolve, reject) => {
    frame.addEventListener('load', resolve, { once: true })
    frame.addEventListener('error', () => reject(new Error('The page could not be laid out.')), { once: true })
  })
  document.body.append(frame)
  try {
    await loaded
    const now = new Date()
    const pageCount = await frame.contentWindow.renderJob({
      text: job.text,
      settings: job.settings,
      paper: size,
      context: {
        fileName: job.fileName,
        folderName: job.folderName,
        date: now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
        time: now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
      },
    })
    const doc = frame.contentDocument
    // Not the Mac's @page size (#page-size): the native side sets the paper itself, and the
    // zoom below would make a size in points disagree with it.
    const styles = [...doc.querySelectorAll(PAGED_BY_THE_SYSTEM ? 'style' : 'style:not(#page-size)')]
      .map((node) => node.textContent).join('\n')
    const pages = doc.getElementById('pages').outerHTML
    const html = '<!doctype html><html><head><meta charset="utf-8">' +
      `<style>${styles}\n${PAGED_BY_THE_SYSTEM ? '' : ONE_POINT_PER_PIXEL}</style></head><body>${pages}</body></html>`
    return { html, pageCount }
  } finally {
    frame.remove()
  }
}
