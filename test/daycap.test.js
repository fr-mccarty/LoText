import { describe, it, expect } from 'vitest'
import { dayCapFileName } from '../src/shared/daycap.js'

describe('dayCapFileName', () => {
  const at = new Date(2026, 8, 28, 9, 5, 7)

  it('is the date and time, local, padded, with dots between the time parts', () => {
    expect(dayCapFileName(at)).toBe('LoText 2026-09-28 09.05.07.md')
  })

  it('numbers the later tries at the same second', () => {
    expect(dayCapFileName(at, 2)).toBe('LoText 2026-09-28 09.05.07-2.md')
    expect(dayCapFileName(at, 3)).toBe('LoText 2026-09-28 09.05.07-3.md')
  })

  it('holds none of the characters a capture sweep strips from a name', () => {
    expect(dayCapFileName(at)).not.toMatch(/[[\]|#^:/]/)
  })
})
