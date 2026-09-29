import { describe, it, expect } from 'vitest'
import { normalizePreset, normalizeLetterheadImage, standardPreset, snapshot } from '../src/shared/settings-shape.js'
import { letterheadBands, hasHeader, hasFooter } from '../src/shared/print/layout.js'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const measure = { width: (text) => text.length * 5, lineHeight: () => 10 }

describe('letterhead images', () => {
  it('keeps a usable image and repairs its numbers', () => {
    expect(normalizeLetterheadImage({ dataURL: PNG, aspect: 2, height: 9, align: 'sideways' }))
      .toEqual({ dataURL: PNG, aspect: 2, height: 3, align: 'left', name: '' })
    expect(normalizeLetterheadImage({ dataURL: PNG, aspect: 2 }).height).toBe(0.75)
  })

  it('drops anything that is not an image it can print', () => {
    for (const raw of [null, 'x', { dataURL: PNG }, { dataURL: 'data:text/html;base64,AA', aspect: 1 },
      { dataURL: 'javascript:1', aspect: 1 }, { dataURL: 'data:image/svg+xml;base64,AA', aspect: 1 }]) {
      expect(normalizeLetterheadImage(raw)).toBe(null)
    }
  })

  it('is part of the preset, and an older preset has none', () => {
    expect(normalizePreset({ id: 'a', name: 'Old', letterhead: { headerLeft: 'x' } }).letterhead)
      .toMatchObject({ headerImage: null, footerImage: null })
    const preset = normalizePreset({ ...standardPreset('b', 'Logo'),
      letterhead: { ...standardPreset().letterhead, headerImage: { dataURL: PNG, aspect: 3, height: 1, align: 'center' } } })
    expect(snapshot(preset).letterhead.headerImage.align).toBe('center')
  })

  it('makes its band at least as tall as it prints, even with no text beside it', () => {
    const letterhead = { ...standardPreset().letterhead, headerLeft: '', footerRight: '',
      headerImage: { dataURL: PNG, aspect: 3, height: 1, align: 'left' }, footerImage: null }
    expect(hasHeader(letterhead)).toBe(true)
    expect(hasFooter(letterhead)).toBe(false)
    const bands = letterheadBands({ showsHeaderAndFooter: true, letterhead }, measure)
    expect(bands).toEqual({ header: 72 + 4 + 8, footer: 0 })
  })
})
