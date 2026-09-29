import { describe, it, expect } from 'vitest'
import { boxOn, boxOffset, flipped, closesBox } from '../src/renderer/editor/task-boxes.js'

describe('finding a box', () => {
  it('finds one at the head of a line, bare or after a list marker', () => {
    expect(boxOffset('[ ] milk')).toBe(0)
    expect(boxOffset('- [x] milk')).toBe(2)
    expect(boxOffset('  * [X] milk')).toBe(4)
    expect(boxOffset('12. [ ] milk')).toBe(4)
  })

  it('leaves brackets elsewhere on a line alone', () => {
    expect(boxOffset('a[x]')).toBe(-1)
    expect(boxOffset('see [ ] here')).toBe(-1)
    expect(boxOffset('[y] no')).toBe(-1)
  })

  it('takes no round boxes', () => {
    expect(boxOffset('( ) milk')).toBe(-1)
    expect(boxOffset('- (x) milk')).toBe(-1)
    expect(boxOn('( ) a')).toBeNull()
    expect(boxOn('- (x) a')).toBeNull()
  })

  it('says whether the box is checked', () => {
    expect(boxOn('[ ] a')).toEqual({ offset: 0, markColumn: 1, checked: false })
    expect(boxOn('- [X] a')).toEqual({ offset: 2, markColumn: 3, checked: true })
  })

  it('finds an enhanced task’s double box, its mark two in', () => {
    expect(boxOn('[[ ]] ==> (()) title')).toEqual({ offset: 0, markColumn: 2, checked: false })
    expect(boxOn('[[x]] ==v (()) title')).toEqual({ offset: 0, markColumn: 2, checked: true })
    expect(boxOn('[[ ] half')).toBeNull()
  })
})

describe('flipping', () => {
  it('checks an empty box and empties a checked one', () => {
    expect(flipped(' ')).toBe('x')
    expect(flipped('x')).toBe(' ')
    expect(flipped('X')).toBe(' ')
  })
})

describe('typing []', () => {
  it('makes a box at the head of a line', () => {
    expect(closesBox('[')).toBe(true)
    expect(closesBox('  - [')).toBe(true)
    expect(closesBox('3) [')).toBe(true)
  })

  it('leaves [] in the middle of a line alone', () => {
    expect(closesBox('const a = [')).toBe(false)
    expect(closesBox('x[')).toBe(false)
    expect(closesBox('')).toBe(false)
  })

  it('leaves () alone, even at the head of a line', () => {
    expect(closesBox('(')).toBe(false)
    expect(closesBox('- (')).toBe(false)
  })
})
