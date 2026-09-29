import { describe, it, expect } from 'vitest'
import { scrollStep, EDGE, MAX_STEP } from '../src/renderer/sidebar/drag-scroll.js'

describe('scrolling the sidebar while dragging', () => {
  const top = 100
  const bottom = 700

  it('does not scroll with the pointer away from both edges', () => {
    expect(scrollStep(400, top, bottom)).toBe(0)
    expect(scrollStep(top + EDGE, top, bottom)).toBe(0)
    expect(scrollStep(bottom - EDGE, top, bottom)).toBe(0)
  })

  it('scrolls up near the top and down near the bottom', () => {
    expect(scrollStep(top + 10, top, bottom)).toBeLessThan(0)
    expect(scrollStep(bottom - 10, top, bottom)).toBeGreaterThan(0)
  })

  it('goes faster nearer the edge', () => {
    expect(scrollStep(bottom - 5, top, bottom)).toBeGreaterThan(scrollStep(bottom - 30, top, bottom))
    expect(scrollStep(top + 5, top, bottom)).toBeLessThan(scrollStep(top + 30, top, bottom))
  })

  it('goes fastest at the edge and past it, never faster', () => {
    expect(scrollStep(bottom, top, bottom)).toBe(MAX_STEP)
    expect(scrollStep(bottom + 200, top, bottom)).toBe(MAX_STEP)
    expect(scrollStep(top - 200, top, bottom)).toBe(-MAX_STEP)
  })

  it('keeps a middle that does not scroll in a short list', () => {
    expect(scrollStep(130, 100, 160)).toBe(0)
    expect(scrollStep(105, 100, 160)).toBeLessThan(0)
  })
})
