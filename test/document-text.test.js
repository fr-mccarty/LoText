import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import { extract } from '../src/shared/viewers/document-text.js'

const inflateRaw = promisify(zlib.inflateRaw)

/** The smallest zip that readDirectory accepts: local headers, a central directory, an end record. */
function zip (files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8')
    const body = zlib.deflateRawSync(Buffer.from(text, 'utf8'))
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, body)
    centrals.push(central, nameBytes)
    offset += 30 + nameBytes.length + body.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}

describe('document text', () => {
  it('reads a docx as its paragraphs', async () => {
    const data = zip({
      'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>First &amp; one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>',
    })
    expect(await extract(data, 'letter.docx', inflateRaw)).toEqual({ kind: 'text', text: 'First & one\nSecond' })
  })

  it('reads an xlsx as a grid of its sheets', async () => {
    const data = zip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="Budget"/></sheets></workbook>',
      'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><t>Cost</t></si></sst>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row><c r="A2" t="inlineStr"><is><t>Tea</t></is></c><c r="B2"><v>4</v></c></row></sheetData></worksheet>',
    })
    expect(await extract(data, 'budget.xlsx', inflateRaw)).toEqual({
      kind: 'table',
      sheets: [{ name: 'Budget', rows: [['Item', 'Cost'], ['Tea', '4']] }],
    })
  })

  it('reads an rtf as its words, Latin-1 escapes included', async () => {
    const rtf = '{\\rtf1\\ansi{\\fonttbl\\f0 Helvetica;}\\f0 Caf\\\'e9\\par Second line}'
    const data = new Uint8Array(Buffer.from(rtf, 'latin1'))
    expect(await extract(data, 'note.rtf', inflateRaw)).toEqual({ kind: 'text', text: 'Café\nSecond line' })
  })

  it('says so, rather than showing a blank, when there is nothing to read', async () => {
    await expect(extract(zip({ 'other.xml': '<x/>' }), 'empty.docx', inflateRaw)).rejects.toThrow('could not be read')
  })
})
