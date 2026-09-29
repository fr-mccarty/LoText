import { describe, it, expect } from 'vitest'
import { dayCapFileName } from '../src/shared/daycap.js'

describe('dayCapFileName', () => {
  const at = new Date(2026, 8, 28, 9, 5, 7)

  it('is DayCap’s own name: local ISO time, then -daycap- and the kind', () => {
    expect(dayCapFileName(at)).toBe('2026-09-28T09:05:07-daycap-note.md')
  })

  it('numbers the later tries at the same second the way DayCap does, -01, -02', () => {
    expect(dayCapFileName(at, 2)).toBe('2026-09-28T09:05:07-daycap-note-01.md')
    expect(dayCapFileName(at, 3)).toBe('2026-09-28T09:05:07-daycap-note-02.md')
  })

  it('sorts by time alongside DayCap’s captures', () => {
    const names = [
      dayCapFileName(new Date(2026, 8, 28, 14, 0, 0)),
      '2026-09-28T09:31:55-daycap-photo.heic',
      dayCapFileName(at),
    ]
    expect([...names].sort()).toEqual([names[2], names[1], names[0]])
  })

  it('holds none of the characters the capture sweep strips from a name', () => {
    expect(dayCapFileName(at, 5)).not.toMatch(/[[\]|#^/]/)
  })
})
