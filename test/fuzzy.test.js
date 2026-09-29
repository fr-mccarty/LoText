import { describe, it, expect } from 'vitest'
import { fold, makeCandidate, makeQuery, score, matches } from '../src/renderer/fuzzy.js'

/** The paths `matches` returns for `query` over `paths`, best first. */
const ranked = (paths, query, limit = 50) =>
  matches(paths.map(makeCandidate), makeQuery(query), limit).map((candidate) => candidate.path)

const scoreOf = (path, query) => score(makeCandidate(path), makeQuery(query))

describe('fold', () => {
  it('lowercases ASCII and leaves everything else in ASCII alone', () => {
    expect(fold('A')).toBe('a')
    expect(fold('z')).toBe('z')
    expect(fold('/')).toBe('/')
    expect(fold('7')).toBe('7')
  })

  it('drops accents, so `cafe` finds `Café`', () => {
    expect(fold('é')).toBe('e')
    expect(fold('É')).toBe('e')
    expect(fold('ñ')).toBe('n')
  })

  it('never changes the length of a character', () => {
    // `ß` uppercases to two characters and has no single-character fold; it stays one.
    expect(Array.from(fold('ß'))).toHaveLength(1)
  })
})

describe('makeQuery', () => {
  it('folds and drops whitespace', () => {
    expect(makeQuery(' Pr Set ')).toEqual(['p', 'r', 's', 'e', 't'])
  })

  it('treats nothing as an empty query', () => {
    expect(makeQuery(undefined)).toEqual([])
    expect(makeQuery(null)).toEqual([])
  })
})

describe('score', () => {
  it('matches characters in order, not as a substring', () => {
    expect(scoreOf('Settings/PrintSettingsTab.swift', 'psettings')).not.toBeNull()
    expect(scoreOf('notes/deep/beta.md', 'ndb')).not.toBeNull()
  })

  it('is null when the characters are not all there in order', () => {
    expect(scoreOf('notes/alpha.md', 'beta')).toBeNull()
    expect(scoreOf('abc', 'cba')).toBeNull()
    expect(scoreOf('ab', 'abc')).toBeNull()
  })

  it('ignores case and accents', () => {
    expect(scoreOf('Café.md', 'cafe')).not.toBeNull()
    expect(scoreOf('README.md', 'readme')).not.toBeNull()
  })

  it('gives an empty query zero, for every path', () => {
    expect(scoreOf('anything/at/all.md', '')).toBe(0)
  })

  it('prefers a contiguous run to scattered characters', () => {
    expect(scoreOf('xabcx.md', 'abc')).toBeGreaterThan(scoreOf('xaxbxcx.md', 'abc'))
  })

  it('prefers characters on a word boundary to the middle of a word', () => {
    expect(scoreOf('big_tree.md', 't')).toBeGreaterThan(scoreOf('bigtree.md', 't'))
  })

  it('counts a camelCase hump as a word boundary', () => {
    expect(scoreOf('PrintSettings.md', 's')).toBeGreaterThan(scoreOf('Printsettings.md', 's'))
  })

  it('finds the best fit rather than the first greedy one', () => {
    // Greedy would take the `p` of `Printing`; the fit the user meant is entirely inside the
    // name, and it should score exactly as it would with no folder in front of it — less the
    // length tie-break.
    const nested = 'Printing/PrintSettings.swift'
    const bare = 'PrintSettings.swift'
    expect(scoreOf(nested, 'pst') + nested.length / 8).toBeCloseTo(scoreOf(bare, 'pst') + bare.length / 8)
  })
})

describe('matches', () => {
  it('lists every candidate, in order, for an empty query', () => {
    expect(ranked(['b.md', 'a.md', 'c/d.md'], '')).toEqual(['b.md', 'a.md', 'c/d.md'])
  })

  it('drops what does not match', () => {
    expect(ranked(['gamma.md', 'notes/alpha.md', 'notes/deep/beta.md'], 'beta'))
      .toEqual(['notes/deep/beta.md'])
  })

  it('ranks a match inside the name above the same letters spread across folders', () => {
    const paths = ['a/b/c/notes.md', 'abc.md']
    expect(ranked(paths, 'abc')[0]).toBe('abc.md')
  })

  it('ranks the file whose name is the query above one that merely contains it', () => {
    const paths = ['old/todo-archive.md', 'todo.md']
    expect(ranked(paths, 'todo')[0]).toBe('todo.md')
  })

  it('breaks a tie on the shorter name, then the shallower path, then walk order', () => {
    expect(ranked(['x/notes.md', 'notes.md'], 'notes')).toEqual(['notes.md', 'x/notes.md'])
    expect(ranked(['a/same.md', 'b/same.md'], 'same')).toEqual(['a/same.md', 'b/same.md'])
  })

  it('returns at most `limit`', () => {
    const paths = Array.from({ length: 20 }, (_, index) => `file${index}.md`)
    expect(ranked(paths, 'file', 5)).toHaveLength(5)
    expect(ranked(paths, '', 5)).toHaveLength(5)
  })
})
