// The words a word-processor document holds, as **plain text**.
//
// For a letter the words *are* the document, and being able to see one without being able to
// quote a line of it is half an answer — so these go to a selectable read-only text view
// rather than to a rendered picture of a page.
//
// **The formatting is dropped on purpose.** The paragraph breaks stay, because they are the
// text; the bold, the italics, the heading sizes and the document's own colours do not. This
// is a plain-text editor with no syntax highlighting and no WYSIWYG anywhere else, and a pane
// rendering Times headings would be the one place that did. A document arrives in the
// editor's own font, size and line spacing, and follows Settings when those change.
//
// **An empty result counts as a failure.** A blank pane is the one outcome this app never
// wants, because it is indistinguishable from an empty document rendered perfectly. The type
// is named from the extension rather than sniffed, and a zero-length result gets the same
// sentence a corrupt file gets.

import { readNamed, readAll } from './zip.js'
import { fileExtension } from '../binary-types.js'

/**
 * `data` is the file's bytes as a Uint8Array; `inflateRaw(bytes) → Promise<bytes>` is how this
 * platform inflates a zip entry (see zip.js).
 *
 * @returns {Promise<{kind:'text',text:string}|{kind:'table',sheets:Array}|{kind:'image',data:Uint8Array,mime:string}>}
 * @throws when there is nothing to show, which is said in a sentence rather than as a blank.
 */
export async function extract (data, filename, inflateRaw) {
  const extension = fileExtension(filename)
  const result = await (async () => {
    switch (extension) {
      case 'docx': return { kind: 'text', text: await docxText(data, inflateRaw) }
      case 'odt': return { kind: 'text', text: await odtText(data, inflateRaw) }
      case 'rtf': return { kind: 'text', text: rtfText(data) }
      case 'xlsx': return { kind: 'table', sheets: await xlsxSheets(data, inflateRaw) }
      case 'pptx': return { kind: 'text', text: await pptxText(data, inflateRaw) }
      case 'pages':
      case 'numbers':
      case 'key': return iworkPreview(data, inflateRaw)
      default: return null
    }
  })()

  if (!result) throw new Error(`“${filename}” is not a kind of document this can show.`)
  if (result.kind === 'text' && !result.text.trim()) {
    throw new Error(`“${filename}” could not be read — it may not be the kind of file its name says it is.`)
  }
  if (result.kind === 'table' && !result.sheets.length) {
    throw new Error(`“${filename}” could not be read — it may not be the kind of file its name says it is.`)
  }
  return result
}

// MARK: - Office

async function docxText (data, inflateRaw) {
  const xml = await readNamed(data, (name) => name === 'word/document.xml', inflateRaw)
  if (!xml) return ''
  return paragraphsFromXML(utf8(xml), 'w:p', 'w:t', { breaks: ['w:br', 'w:tab'] })
}

async function odtText (data, inflateRaw) {
  const xml = await readNamed(data, (name) => name === 'content.xml', inflateRaw)
  if (!xml) return ''
  return paragraphsFromXML(utf8(xml), 'text:(?:p|h)', null, {})
}

async function pptxText (data, inflateRaw) {
  const slides = await readAll(data, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name), inflateRaw)
  return slides
    .map(({ data: slide }) => paragraphsFromXML(utf8(slide), 'a:p', 'a:t', {}))
    .filter(Boolean)
    .join('\n\n')
}

/**
 * One sheet per worksheet, as rows of strings. A spreadsheet's *layout* is the document, so
 * this is drawn as a grid rather than poured into a paragraph.
 */
async function xlsxSheets (data, inflateRaw) {
  const shared = await sharedStrings(data, inflateRaw)
  const names = await workbookSheetNames(data, inflateRaw)
  const sheets = await readAll(data, (name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name), inflateRaw)
  return sheets.map((sheet, index) => ({
    name: names[index] ?? `Sheet ${index + 1}`,
    rows: worksheetRows(utf8(sheet.data), shared),
  })).filter((sheet) => sheet.rows.length)
}

async function sharedStrings (data, inflateRaw) {
  const xml = await readNamed(data, (name) => name === 'xl/sharedStrings.xml', inflateRaw)
  if (!xml) return []
  const text = utf8(xml)
  const strings = []
  for (const match of text.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    strings.push(collapse(textNodes(match[1], 't')))
  }
  return strings
}

async function workbookSheetNames (data, inflateRaw) {
  const xml = await readNamed(data, (name) => name === 'xl/workbook.xml', inflateRaw)
  if (!xml) return []
  return [...utf8(xml).matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)]
    .map((match) => decodeEntities(match[1]))
}

function worksheetRows (xml, shared) {
  const rows = []
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = []
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1]
      const body = cellMatch[2]
      const reference = /\br="([A-Z]+)\d+"/.exec(attributes)
      const column = reference ? columnIndex(reference[1]) : cells.length
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1]
      let value
      if (type === 's') {
        const index = Number(textNodes(body, 'v'))
        value = shared[index] ?? ''
      } else if (type === 'inlineStr') {
        value = collapse(textNodes(body, 't'))
      } else {
        value = collapse(textNodes(body, 'v'))
      }
      while (cells.length < column) cells.push('')
      cells[column] = value
    }
    // A row of nothing is still a row in a spreadsheet's shape, but a trailing run of them is
    // just the sheet's unused grid and has no business being drawn.
    rows.push(cells)
  }
  while (rows.length && rows[rows.length - 1].every((cell) => !cell)) rows.pop()
  return rows
}

function columnIndex (letters) {
  let index = 0
  for (const character of letters) index = index * 26 + (character.charCodeAt(0) - 64)
  return index - 1
}

// MARK: - iWork

/**
 * The iWork formats keep their document in a proprietary archive there is no honest way to
 * read here. Every one of them also ships the preview its own app drew, so that is what is
 * shown — a picture of the document, said to be one.
 */
async function iworkPreview (data, inflateRaw) {
  const image = await readNamed(data, (name) =>
    /^(QuickLook\/(Thumbnail|Preview)\.(jpg|jpeg|png)|preview(-web|-micro)?\.jpg)$/i.test(name), inflateRaw)
  if (!image) throw new Error('This document carries no preview that can be shown here.')
  return { kind: 'image', data: image, mime: image[0] === 0x89 ? 'image/png' : 'image/jpeg' }
}

// MARK: - RTF

/**
 * Rich text opened as text for a while and showed the user its own markup, which is not what
 * anybody double-clicks an `.rtf` to see. Control words are dropped, groups the reader is
 * meant to skip are skipped whole, and what is left is the words.
 */
function rtfText (data) {
  const source = latin1(data)
  let out = ''
  let index = 0
  let depth = 0
  const skipDepth = []

  while (index < source.length) {
    const character = source[index]

    if (character === '\\') {
      const control = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(source.slice(index))
      if (control) {
        const word = control[1]
        const parameter = control[2] ? Number(control[2]) : null
        index += control[0].length
        if (word === 'par' || word === 'line' || word === 'sect') out += '\n'
        else if (word === 'tab') out += '\t'
        else if (word === 'u' && parameter !== null) {
          out += String.fromCharCode(parameter < 0 ? parameter + 65536 : parameter)
          if (source[index] === '?') index += 1
        } else if (SKIPPED_GROUPS.has(word)) {
          skipDepth.push(depth)
        }
        continue
      }
      const escape = /^\\'([0-9a-fA-F]{2})/.exec(source.slice(index))
      if (escape) {
        if (!skipDepth.length) out += String.fromCharCode(parseInt(escape[1], 16))
        index += escape[0].length
        continue
      }
      if (!skipDepth.length) out += source[index + 1] ?? ''
      index += 2
      continue
    }

    if (character === '{') { depth += 1; index += 1; continue }
    if (character === '}') {
      depth -= 1
      if (skipDepth.length && depth <= skipDepth[skipDepth.length - 1]) skipDepth.pop()
      index += 1
      continue
    }
    if (character === '\r' || character === '\n') { index += 1; continue }

    if (!skipDepth.length) out += character
    index += 1
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

const SKIPPED_GROUPS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'themedata',
  'colorschememapping', 'latentstyles', 'datastore', 'generator', 'listtable',
  'listoverridetable', 'rsidtbl', 'xmlnstbl', 'filetbl', 'mmathPr',
])

// MARK: - Bytes to text

function utf8 (bytes) {
  return new TextDecoder('utf-8').decode(bytes)
}

/** One character per byte, as Latin-1 reads it — what an RTF file's own text is written in. */
function latin1 (bytes) {
  let out = ''
  for (let start = 0; start < bytes.length; start += 8192) {
    out += String.fromCharCode.apply(null, bytes.subarray(start, start + 8192))
  }
  return out
}

// MARK: - XML helpers

/**
 * Paragraph-per-line, which is the only structure kept: the paragraph breaks are the text.
 * Everything else the markup says about how it looked is dropped.
 */
function paragraphsFromXML (xml, paragraphTag, textTag, { breaks = [] }) {
  const pattern = new RegExp(`<${paragraphTag}\\b[^>]*(?:/>|>([\\s\\S]*?)</${paragraphTag.replace(/\(\?:.*\)/, '[^>]+')}>)`, 'g')
  const paragraphs = []
  for (const match of xml.matchAll(pattern)) {
    let body = match[1] ?? ''
    for (const tag of breaks) body = body.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'g'), tag.endsWith('tab') ? '\t' : '\n')
    paragraphs.push(textTag ? collapse(textNodes(body, textTag)) : collapse(stripTags(body)))
  }
  return paragraphs.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function textNodes (xml, tag) {
  const escaped = tag.replace(/:/g, '\\:')
  let out = ''
  for (const match of xml.matchAll(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}>`, 'g'))) {
    out += match[1]
  }
  return out
}

function stripTags (xml) {
  return xml.replace(/<[^>]*>/g, '')
}

function collapse (text) {
  return decodeEntities(text).replace(/\r/g, '')
}

function decodeEntities (text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}
