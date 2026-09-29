// ⌘P prints the open file only — never the whole folder, never a selection.
//
// The job runs in a window that never shows: it is handed the text and one preset, it lays
// the document out and draws every page, and then the same drawn pages go either to the
// printer or to a PDF. A page that prints on paper and the same page in a PDF cannot drift
// apart, because there is only one of them.

import path from 'node:path'
import { promises as fs } from 'node:fs'
import { BrowserWindow } from 'electron'
import { PAPER_SIZES, POINTS_PER_INCH } from '../../shared/settings-shape.js'

/**
 * Lays the document out in a hidden window and hands the window back, still holding the
 * drawn pages. The caller decides what to do with them.
 */
async function draw ({ text, settings, fileName, folderName, paper }) {
  const size = PAPER_SIZES[paper] ?? PAPER_SIZES.letter
  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { contextIsolation: true, nodeIntegration: false, offscreen: false },
  })
  await window.loadFile(path.join(__dirname, 'print.html'))

  const now = new Date()
  const job = {
    text,
    settings,
    paper: size,
    context: {
      fileName,
      folderName,
      date: now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
      time: now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    },
  }
  const pageCount = await window.webContents.executeJavaScript(
    `window.renderJob(${JSON.stringify(job)})`)
  return { window, size, pageCount }
}

/**
 * The system print panel, over the pages already drawn. Margins are `none` because the layout
 * has already inset the content by the preset's own four margins — asking the browser for a
 * second set would inset it twice.
 */
export async function print (job) {
  const { window, size } = await draw(job)
  return new Promise((resolve) => {
    window.webContents.print({
      silent: false,
      printBackground: true,
      margins: { marginType: 'none' },
      pageSize: { width: pointsToMicrons(size.width), height: pointsToMicrons(size.height) },
    }, (success, reason) => {
      window.destroy()
      resolve({ success, reason })
    })
  })
}

/** The same pages, written out instead. This is what the command line asks for. */
export async function writePDF (job, destination) {
  const { window, size } = await draw(job)
  try {
    const data = await window.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      pageSize: { width: size.width / POINTS_PER_INCH, height: size.height / POINTS_PER_INCH },
      preferCSSPageSize: false,
    })
    if (destination === '-') process.stdout.write(data)
    else await fs.writeFile(destination, data)
    return data.length
  } finally {
    window.destroy()
  }
}

function pointsToMicrons (points) {
  return Math.round((points / POINTS_PER_INCH) * 25400)
}
