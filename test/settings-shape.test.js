import { describe, it, expect } from 'vitest'
import { normalizeView, DEFAULT_VIEW } from '../src/shared/settings-shape.js'

describe('Tab inserts', () => {
  it('defaults to 2 spaces', () => {
    expect(DEFAULT_VIEW.tabSpaces).toBe(2)
    expect(normalizeView({}).tabSpaces).toBe(2)
  })

  it('keeps 4 when chosen, and takes anything else as 2', () => {
    expect(normalizeView({ tabSpaces: 4 }).tabSpaces).toBe(4)
    expect(normalizeView({ tabSpaces: '4' }).tabSpaces).toBe(4)
    for (const value of [2, 3, 8, 'x', null]) expect(normalizeView({ tabSpaces: value }).tabSpaces).toBe(2)
  })
})
