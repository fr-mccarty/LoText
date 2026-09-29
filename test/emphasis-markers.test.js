import { describe, it, expect } from 'vitest'
import { editsFor, BOLD, ITALIC } from '../src/renderer/editor/emphasis-markers.js'
import { range, maxRange } from '../src/renderer/editor/text-ranges.js'

/** Run ⌘B or ⌘I over `sites` the way the editor does: every edit back to front, in one go. */
const press = (text, sites, marker) => {
  const { edits, selections } = editsFor(sites, marker, text)
  const out = [...edits].reverse().reduce((acc, edit) =>
    acc.slice(0, edit.range.location) + edit.replacement + acc.slice(maxRange(edit.range)), text)
  return { text: out, selections }
}

const all = (text) => [range(0, text.length)]

describe('wrapping', () => {
  // Lolext's EmphasisShortcutTests: the markers go around the words, not around the newline.
  it('puts ** around a select-all, inside the line', () => {
    expect(press('hello world\n', all('hello world\n'), BOLD).text).toBe('**hello world**\n')
  })

  it('puts * around the selection for italic', () => {
    expect(press('word', all('word'), ITALIC).text).toBe('*word*')
  })

  it('keeps the selection on the text it was on', () => {
    expect(press('word', all('word'), BOLD).selections).toEqual([range(2, 4)])
  })

  // The printer reads emphasis a line at a time, so each line gets its own pair and blank lines
  // get none.
  it('marks each line of a multi-line selection separately', () => {
    const text = 'one\ntwo\n\nthree\n'
    const result = press(text, all(text), BOLD)
    expect(result.text).toBe('**one**\n**two**\n\n**three**\n')
    expect(result.selections).toEqual([range(2, 3), range(10, 3), range(19, 5)])
  })

  it('leaves indentation and trailing spaces outside the markers', () => {
    expect(press('  one  \n', all('  one  \n'), BOLD).text).toBe('  **one**  \n')
  })

  it('touches only the selection', () => {
    expect(press('one\ntwo\nthree\n', [range(0, 3)], ITALIC).text).toBe('*one*\ntwo\nthree\n')
  })
})

describe('a caret with no selection', () => {
  it('takes the word under the caret', () => {
    const result = press('alpha beta gamma', [range(8)], BOLD)
    expect(result.text).toBe('alpha **beta** gamma')
    expect(result.selections).toEqual([range(8, 4)])
  })

  it('takes the word the caret is just past', () => {
    expect(press('alpha beta', [range(5)], BOLD).text).toBe('**alpha** beta')
  })

  // Nothing to wrap, so an empty pair opens with the caret between the markers.
  it('opens an empty pair where there is no word', () => {
    const result = press('a  b', [range(2)], BOLD)
    expect(result.text).toBe('a **** b')
    expect(result.selections).toEqual([range(4)])
  })

  // …and pressing it again with the caret still there closes the pair back up.
  it('takes an empty pair away again', () => {
    const result = press('a **** b', [range(4)], BOLD)
    expect(result.text).toBe('a  b')
    expect(result.selections).toEqual([range(2)])
  })

  it('unbolds the bold word the caret is in', () => {
    const result = press('x **hello** y', [range(5)], BOLD)
    expect(result.text).toBe('x hello y')
    expect(result.selections).toEqual([range(2, 5)])
  })
})

describe('unwrapping', () => {
  // The markers inside the selection: `|**hello**|`.
  it('takes the markers off when they are selected with the word', () => {
    const result = press('**hello**', all('**hello**'), BOLD)
    expect(result.text).toBe('hello')
    expect(result.selections).toEqual([range(0, 5)])
  })

  // The markers just outside it: `**|hello|**`.
  it('takes the markers off when they are just outside the selection', () => {
    const result = press('**hello**', [range(2, 5)], BOLD)
    expect(result.text).toBe('hello')
    expect(result.selections).toEqual([range(0, 5)])
  })

  it('unwraps every line of a multi-line selection', () => {
    const text = '**one**\n**two**\n'
    expect(press(text, all(text), BOLD).text).toBe('one\ntwo\n')
  })

  it('takes italic off italic', () => {
    expect(press('*word*', all('*word*'), ITALIC).text).toBe('word')
    expect(press('*word*', [range(1, 4)], ITALIC).text).toBe('word')
  })
})

describe('bold and italic share a character', () => {
  // Lolext's EmphasisShortcutTests: italic over bold must add italic, not eat the bold.
  it('adds italic over **bold**, selected whole', () => {
    expect(press('**bold**', all('**bold**'), ITALIC).text).toBe('***bold***')
  })

  it('adds italic over **bold**, markers outside the selection', () => {
    expect(press('**bold**', [range(2, 4)], ITALIC).text).toBe('***bold***')
  })

  it('adds bold over *italic*', () => {
    expect(press('*it*', all('*it*'), BOLD).text).toBe('***it***')
  })

  // A run of three carries both, so either shortcut takes off only its own share.
  it('takes only the bold off ***both***', () => {
    expect(press('***word***', all('***word***'), BOLD).text).toBe('*word*')
  })

  it('takes only the italic off ***both***', () => {
    expect(press('***word***', all('***word***'), ITALIC).text).toBe('**word**')
  })
})

describe('several carets', () => {
  // Both resolve to the same word; editing it twice would double the markers.
  it('marks a word once when two carets are inside it', () => {
    const result = press('alpha beta', [range(1), range(3)], BOLD)
    expect(result.text).toBe('**alpha** beta')
    expect(result.selections).toEqual([range(2, 5)])
  })

  it('marks each word, shifting the later selections along', () => {
    const result = press('alpha beta', [range(1), range(7)], BOLD)
    expect(result.text).toBe('**alpha** **beta**')
    expect(result.selections).toEqual([range(2, 5), range(12, 4)])
  })

  it('unwraps and wraps independently', () => {
    expect(press('**alpha** beta', [range(4), range(12)], BOLD).text).toBe('alpha **beta**')
  })
})

describe('what counts as a word and as whitespace, as Foundation reads them', () => {
  // Lolext's word set is CharacterSet.alphanumerics, which includes combining marks (M*): a
  // decomposed é is one word with its accent, not a word followed by a stray accent.
  it('keeps a combining accent inside the word', () => {
    expect(press('cafe\u0301 au lait', [range(2)], BOLD).text).toBe('**cafe\u0301** au lait')
  })

  it('counts spacing and enclosing marks too', () => {
    expect(press('\u0915\u093f x', [range(0)], ITALIC).text).toBe('*\u0915\u093f* x')
  })

  // CharacterSet.whitespacesAndNewlines holds U+200B and U+0085 and not U+FEFF — not what
  // JavaScript's \s says.
  it('trims a zero-width space off the ends of a line', () => {
    const text = '\u200bword\u200b'
    expect(press(text, all(text), BOLD).text).toBe('\u200b**word**\u200b')
  })

  it('does not trim a byte-order mark', () => {
    const text = '\ufeffword'
    expect(press(text, all(text), BOLD).text).toBe('**\ufeffword**')
  })
})
