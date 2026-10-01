// Help ▸ Enhanced Tasks, Help ▸ Disclosure Arrows and Help ▸ Markdown Formatting: three reference
// sheets, each with a place to try it.
//
// No sheet describes a copy of the feature. The enhanced-tasks and disclosure-arrows sheets run
// small editors with the same extensions as the real one, and the markdown sheet draws its
// "prints as" column with the printer's own parser — so what the sheet shows cannot drift from
// what the app does. The written rules come from `specs/enhanced-tasks.md`,
// `specs/disclosures.md`, `specs/task-boxes.md` and `src/shared/markdown/`; change them there first.

import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { history } from '@codemirror/commands'
import { parseBlocks, BOLD, ITALIC, CODE } from '../../shared/markdown/blocks.js'
import { taskBoxes } from '../editor/task-boxes.js'
import { enhancedTasks, moveItems } from '../editor/enhanced-view.js'
import { element, clear } from '../dom.js'

export const HELP_TOPICS = {
  helpTasks: { title: 'Enhanced Tasks', build: enhancedTasksHelp },
  helpDisclosures: { title: 'Disclosure Arrows', build: disclosuresHelp },
  helpMarkdown: { title: 'Markdown Formatting', build: markdownHelp },
}

export class HelpSheet {
  constructor (model, topic) {
    this.model = model
    this.topic = HELP_TOPICS[topic]
    this.disposers = []
  }

  build () {
    const body = element('div', { class: 'help-body' })
    this.node = element('div', { class: 'sheet help', tabindex: '0' }, [
      element('div', { class: 'sheet-eyebrow', text: `Help · ${this.topic.title}` }),
      body,
      element('div', { class: 'sheet-divider' }),
      element('div', { class: 'sheet-status help-status' }, [
        element('span', { text: 'esc to close' }),
        element('button', { class: 'plain', text: 'Done', onclick: () => this.model.closeSheet() }),
      ]),
    ])
    // Escape closes from anywhere in the sheet, the try-it editor included.
    this.node.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.model.closeSheet() }
    })
    body.append(...this.topic.build((dispose) => this.disposers.push(dispose)))
    requestAnimationFrame(() => this.node.focus())
    return this.node
  }

  dispose () {
    for (const dispose of this.disposers) dispose()
  }
}

// MARK: - Pieces

const section = (title, ...children) =>
  element('section', { class: 'help-section' }, [element('h2', { text: title }), ...children])

const para = (...parts) => element('p', {}, parts.map((part) =>
  typeof part === 'string' ? document.createTextNode(part) : part))

const code = (text) => element('code', { text })

const source = (text) => element('pre', { class: 'help-source', text })

const list = (...items) => element('ul', {}, items.map((item) =>
  element('li', {}, [].concat(item).map((part) => typeof part === 'string' ? document.createTextNode(part) : part))))

// MARK: - Try it

/**
 * A try-it editor with the real extensions. ⌥↑ / ⌥↓ are bound here
 * as in the app's editor, since the menu never receives them (`discoveries/editor-and-window-pitfalls.md`).
 */
function tryIt (doc, onDispose) {
  const host = element('div', { class: 'help-try' })
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        taskBoxes,
        enhancedTasks,
        keymap.of([
          { key: 'Alt-ArrowUp', run: (target) => moveItems(target, -1) },
          { key: 'Alt-ArrowDown', run: (target) => moveItems(target, 1) },
        ]),
        EditorView.lineWrapping,
      ],
    }),
  })
  onDispose(() => view.destroy())
  return host
}

const strong = (text) => element('strong', { text })

// MARK: - Enhanced tasks

const TASK_EXAMPLE = `[[ ]] ==v (()) This is an enhanced task
  This is the description. It could have labels, or be a paragraph.
  Email id: 5678987656789
  [ ] send an email
  [ ] send a text
  [ ] 
[[ ]] ==> (()) The next task
  Its description, hidden until its arrow is clicked.
`

const TASK_MOVE_EXAMPLE = `[[ ]] ==> (()) call the tribunal
  Ask about the hearing date.
  [ ] ring the clerk
[[x]] ==> (()) send the bundle
  [x] post it
  [ ] email it
`

const BOX_EXAMPLE = `- [ ] buy stamps
- [x] post the bundle
1. [ ] ring the clerk
[ ] do something
`

function enhancedTasksHelp (onDispose) {
  return [
    para('An enhanced task is a to-do an agent has added to: a description, reference data it needs to keep ',
      '(ids and the like), and choices of what to do next for you to pick from. It is all plain text, so the file ',
      'reads anywhere. The double arrow — ', code('==>'), ' collapsed, ', code('==v'), ' expanded — shows and hides ',
      'what is under the task, and because it is text, what is open is saved with the file.'),

    section('Try it',
      para('A live editor running the app’s own code. Click the arrows. Click a choice’s box, or type into the empty one. ',
        'Check a task’s box, then click its arrow. Nothing here is saved.'),
      tryIt(TASK_EXAMPLE, onDispose)),

    section('The parts',
      source(`[[ ]] ==v (()) This is an enhanced task  ← the task line, always shown
  This is the description.              ← everything indented under it
  Email id: 5678987656789               ← reference data
  [ ] send an email                     ← the choices, the actions it proposes
  [ ] send a text`),
      list(
        ['The ', strong('box'), ', ', code('[[ ]]'), ', is checked as ', code('[[x]]'), '.'],
        ['The ', strong('arrow'), ', ', code('==>'), ' or ', code('==v'), ', shows the task collapsed or expanded.'],
        ['The ', strong('feedback slot'), ', ', code('(())'), ', is where you write to the agent: ', code('((ring first))'), '.'],
        ['The ', strong('choices'), ' are ', code('  [ ]'), ' lines under the task, indented two spaces. The agent carries out the ones you check.'],
        ['A task owns the lines indented under it, as a disclosure arrow does: the first line back at the left edge, or two empty lines in a row, ends it. A single empty line with an indented line after it belongs to the task.'],
      )),

    section('Clicking',
      list(
        ['The ', strong('arrow'), ' flips between ', code('==>'), ' and ', code('==v'), '. The caret stays put, and ⌘Z undoes it.'],
        ['The ', strong('task’s box'), ' flips between empty and checked. Checking it also turns ', code('==v'), ' into ', code('==>'), ' in the same edit, so the lines indented under it hide. Unchecking changes no arrow.'],
        ['A ', strong('choice’s box'), ' flips, as any box does.'],
        'A click on text places the caret, so the title and everything under it stay editable.',
      )),

    section('Typing',
      list(
        ['Typing ', code('x'), ' into the task’s box checks it and collapses the task, as a click would.'],
        ['Typing into an empty choice (', code('  [ ] '), ') checks it. This happens only under an enhanced task.'],
        ['An arrow you type or paste arrives expanded: ', code('==>'), ' is written ', code('==v'), ', caret after it, so nothing hides the moment it appears.'],
        'Arrows already in the file, or arriving from disk, keep their state. A click collapses one.',
      )),

    section('What is hidden',
      list(
        ['A collapsed task hides every line it owns. The arrow is the only sign: nothing is drawn after it.'],
        'The arrow keys skip hidden lines. A caret that Find or undo drops into them shows them, without rewriting the arrow, and they hide again at the next click on that task’s arrow.',
        ['A disclosure arrow (', code('-->'), ' or ', code('==>'), ') on a line under a task works as it does anywhere (Help ▸ Disclosure Arrows).'],
      )),

    section('Moving',
      para('Put the caret on a task line and press ⌥↑ or ⌥↓ (Edit ▸ Move Line Up / Down).'),
      tryIt(TASK_MOVE_EXAMPLE, onDispose),
      list(
        'The whole task moves: its line and everything it owns, collapsed or expanded, checked or not. That happens whenever the selected lines include the task line.',
        'It steps over a whole neighbour in one press — a whole task, or a whole disclosure arrow’s section — so it never lands inside another item.',
        'A visible line of the task, on its own, moves one line at a time, as any line does.',
        'Any other line steps over a collapsed task whole, and into an expanded one a line at a time.',
        'The text is kept exactly and the arrows keep their state. The caret keeps its place, and one ⌘Z undoes the move.',
        'With the caret on a collapsed task’s line and nothing selected, ⌘X cuts the whole task, hidden lines and all. An expanded task’s line is cut on its own.',
      )),

    section('Plain boxes',
      para('A ', code('[ ]'), ' or ', code('[x]'), ' at the head of a line is a box in any file, task or not:'),
      tryIt(BOX_EXAMPLE, onDispose),
      list(
        ['The head of a line is after its indent and an optional list marker: ', code('-'), ', ', code('*'), ', ', code('+'), ', ', code('1.'), ' or ', code('1)'), '. Elsewhere, as in ', code('a[x]'), ' or ', code('const a = []'), ', brackets are plain text.'],
        'A click flips the box. The caret stays put.',
        ['Typing ', code('[]'), ' there gives ', code('[ ]'), '.'],
        ['A plain ', code('[ ] do something'), ' is not an enhanced task: nothing hides, and checking it changes only the box.'],
      )),

    section('Printing',
      para('Printing and PDF show the text as written, arrows and all. Enhanced tasks are an editor feature only.')),
  ]
}

// MARK: - Disclosure arrows

const DISCLOSURE_EXAMPLE = `submission_to_tribunal_date* --v
  Type: date
  Width in Sixths: 3 --v
    More Detail Here: ;lkjlkajsfdf
next line
`

const DISCLOSURE_MOVE_EXAMPLE = `Fields --v
  Name -->
    Type: text
  Date --v
    Type: date
    Width in Sixths: 3
next line
`

const DISCLOSURE_TASK_EXAMPLE = `[[ ]] ==v (()) do something agent
  This is the description.
  Email id: 5678987656789
  Thread --v
    id: abc
  [ ] send an email
`

function disclosuresHelp (onDispose) {
  return [
    para('A disclosure arrow is a ', code('-->'), ' or ', code('--v'), ' anywhere on a line. It shows and hides the ',
      'lines under it indented deeper — its body — so a long note folds down to its headings. ',
      code('-->'), ' is closed, the body hidden; ', code('--v'), ' is open. The double arrow, ', code('==>'), ' / ', code('==v'),
      ', works the same way. The arrow is ordinary text drawn as a small button, so which parts are open is saved with the file.'),

    section('Try it',
      para('A live editor running the app’s own code, at 2 spaces. Click the arrows. Nothing here is saved.'),
      tryIt(DISCLOSURE_EXAMPLE, onDispose)),

    section('The parts',
      source(`submission_to_tribunal_date* --v    ← a line with a disclosure arrow
  Type: date                        ← its body: every line deeper
  Width in Sixths: 3 --v            ← a body line with an arrow of its own
    More Detail Here: ;lkjlkajsfdf  ← that arrow’s body, one more step deeper
next line                           ← back at the edge: ends both bodies`)),

    section('Where one can sit',
      list(
        ['Anywhere on a line: at its start (', code('--> Plan'), '), in the middle (', code('Plan --> week'), ') or at its end (', code('Plan -->'), ').'],
        ['It needs a space or the start of the line before it, and a space or the end of the line after it. ', code('text-->'), ' and ', code('--verbose'), ' are plain text.'],
        ['Only the first arrow on a line counts. In ', code('a --v b --> c'), ' the ', code('--v'), ' is the button and the ', code('-->'), ' is plain text.'],
        ['The double arrow, ', code('==>'), ' / ', code('==v'), ', is a disclosure arrow too, except on an enhanced task’s line, where it is the task’s own (Help ▸ Enhanced Tasks).'],
        ['A line with ', code('<!--'), ' before the arrow, such as ', code('<!-- note -->'), ', is an HTML comment and stays plain text. So does ', code('-->'), ' alone in the first column, the end of a longer comment.'],
      )),

    section('What belongs to it',
      list(
        'The body is every line straight under the arrow’s line indented deeper than it, by any amount. Closing the arrow hides them all.',
        ['A body line with an arrow owns the lines deeper still under it, and so on. Above, everything down to ', code('More Detail Here'), ' belongs to the first line, and ', code('More Detail Here'), ' also belongs to ', code('Width in Sixths'), '.'],
        'A line indented no deeper than the arrow’s line ends the body, and so do two empty lines in a row. A single empty line with a deeper line after it belongs to the body and hides with it.',
        'An arrow with nothing under it still takes a click; it only changes the text.',
      )),

    section('Clicking',
      list(
        ['An arrow flips between ', code('-->'), ' and ', code('--v'), '. ⌘Z undoes it.'],
        'The caret stays put, unless it was in what the click hides; then it goes to the end of the arrow’s line.',
        'Closing an arrow hides its whole body, nested arrows and all. Opening it shows the body, and the nested arrows then follow their own state.',
        'A click on text places the caret, so the line and its body stay editable.',
      )),

    section('Typing',
      list(
        ['An arrow you type or paste arrives open, wherever it is on the line: ', code('-->'), ' is written ', code('--v'), ' and ', code('==>'), ' is written ', code('==v'), ', so nothing hides. It stays open until you click it. The caret stays after it.'],
        'Arrows already in the file, arriving from disk (⌘R, a change made elsewhere), or put back by undo keep their state. A click is the way to close one.',
      )),

    section('What is hidden',
      list(
        ['A closed arrow hides its body. Nothing is drawn after it: ', code('-->'), ' is the only sign that lines are folded.'],
        'The arrow keys skip hidden lines. A caret that Find or undo drops into them shows them, and so does an edit that reaches into them. The arrow is not rewritten, and they hide again at the next click on it.',
        'A long body line wraps onto rows indented as far as its own text, not back to the left edge. No spaces are added to the text.',
      )),

    section('Hiding from the keyboard',
      list(
        ['Edit ▸ Hide Lines (⌘[) closes the arrow the caret is in, the same edit as a click; press it again to close the next arrow out. Edit ▸ Show Lines (⌘]) opens the arrow on the caret’s line.'],
        ['A line needs no arrow: ⌘[ on it, or on a line under it, hides the lines indented deeper under it, with ', code('⋯'), ' after it.'],
        ['Select several lines and press ⌘[: the first line stays and the rest hide. When the first line has an arrow, that arrow closes. Otherwise nothing is written to the file, and ', code('⋯'), ' after the first line shows them again, as does ⌘] on that line.'],
        'Lines hidden with ⋯ show again when an edit or Find reaches into them, and are forgotten when the file closes.',
      )),

    section('Moving',
      para('Put the caret on ', code('Name -->'), ' and press ⌥↓ (Edit ▸ Move Line Down). Or put it on ',
        code('next line'), ' and press ⌥↑ twice.'),
      tryIt(DISCLOSURE_MOVE_EXAMPLE, onDispose),
      list(
        ['A ', strong('closed'), ' arrow’s line moves with its whole body, nested arrows and all. It steps over a whole neighbour in one press — a whole task or disclosure section, open or closed — so it never lands inside another item, though it can leave the section it is in.'],
        ['An ', strong('open'), ' arrow’s line moves on its own, one line at a time.'],
        'Any other line also moves one line at a time, so it can be moved into and out of an open section. A closed arrow counts as one line with what it hides, so a line steps over it and never lands among hidden lines.',
        'Nothing is reindented, so a moved body may belong to another line afterwards. Arrows keep their state, the caret keeps its place, and one ⌘Z undoes the move.',
        ['With the caret on a ', strong('closed'), ' arrow’s line and nothing selected, ⌘X cuts it with its whole body. An open arrow’s line is cut on its own.'],
      )),

    section('Inside an enhanced task',
      tryIt(DISCLOSURE_TASK_EXAMPLE, onDispose),
      list(
        ['A line under a task may have a disclosure arrow, with its own indent as the base: ', code('  Thread --v'), ' owns ', code('    id: abc'), '.'],
        'The task line is never a disclosure: its only button is the task’s own arrow, and any other arrow in its title is plain text.',
        'Collapsing the task hides these lines with the rest; their arrows keep their state.',
      )),

    section('Printing',
      para('Printing and PDF show the text as written, arrows and all. Disclosure arrows are an editor feature only.')),
  ]
}

// MARK: - Markdown

const MARKDOWN_EXAMPLE = `# Parish Council

Minutes for **Tuesday**, with *two* items
and one \`code\` word.

| Item   | Qty | Price |
|--------|:---:|------:|
| Chairs |  40 | 120.00 |
| Urn    |  1  |  35.50 |
`

/** The printer's own reading of `text`, drawn as HTML. */
function printed (text) {
  const out = element('div', { class: 'help-printed' })
  for (const block of parseBlocks(text)) {
    if (block.kind === 'heading') {
      out.append(element(`h${block.level}`, { class: 'help-printed-heading' }, spans(block.text)))
    } else if (block.kind === 'paragraph') {
      out.append(element('div', { class: 'help-printed-paragraph' },
        block.lines.map((line) => element('div', {}, spans(line)))))
    } else if (block.kind === 'table') {
      const { header, alignments, rows } = block.table
      const cell = (tag, content, index) =>
        element(tag, { style: { textAlign: { leading: 'left', center: 'center', trailing: 'right' }[alignments[index]] } }, spans(content))
      out.append(element('table', { class: 'help-printed-table' }, [
        element('thead', {}, [element('tr', {}, header.map((content, index) => cell('th', content, index)))]),
        element('tbody', {}, rows.map((row) => element('tr', {}, row.map((content, index) => cell('td', content, index))))),
      ]))
    }
  }
  return out
}

function spans (runs) {
  return runs.map(({ text, style }) => {
    let node = document.createTextNode(text)
    if (style & CODE) node = element('code', {}, [node])
    if (style & ITALIC) node = element('em', {}, [node])
    if (style & BOLD) node = element('strong', {}, [node])
    return node
  })
}

/** One rule: what you type on the left, what prints on the right. */
const example = (text) => element('div', { class: 'help-example' }, [
  element('div', {}, [element('div', { class: 'help-label', text: 'You type' }), source(text)]),
  element('div', {}, [element('div', { class: 'help-label', text: 'Prints as' }), printed(text)]),
])

function markdownHelp () {
  const input = element('textarea', { class: 'help-source help-input', spellcheck: 'false' })
  input.value = MARKDOWN_EXAMPLE
  const preview = element('div', {}, [printed(MARKDOWN_EXAMPLE)])
  input.addEventListener('input', () => { clear(preview); preview.append(printed(input.value)) })

  return [
    para('The editor always shows exactly the characters you typed — ', code('**bold**'), ' stays ',
      code('**bold**'), ' on screen. Formatting happens on paper: when you print or save a PDF. ',
      'The dialect is small on purpose: headings, paragraphs, tables, and bold, italic and code inside a line. ',
      'Anything else prints exactly as typed.'),

    section('Try it',
      para('Type on the left; the right is drawn by the same code the printer uses.'),
      element('div', { class: 'help-example' }, [
        element('div', {}, [element('div', { class: 'help-label', text: 'You type' }), input]),
        element('div', {}, [element('div', { class: 'help-label', text: 'Prints as' }), preview]),
      ])),

    section('Headings',
      example('# Heading 1\n## Heading 2\n### Heading 3\n#### Heading 4'),
      list(
        ['One to six ', code('#'), ' and then a space. Each heading is its own block.'],
        [code('#hashtag'), ' (no space) and ', code('####### seven'), ' are not headings; they print as typed.'],
        'Heading sizes and font come from the print preset in Settings ▸ Printing, which can also print every line at one size.',
      )),

    section('Paragraphs and line breaks',
      example('Each line you type\nprints on its own line.\n\n\n\nBlank lines make one gap, however many.'),
      list(
        'Lines are never joined: a line break you type is a line break on paper.',
        'A blank line starts a new block, with the preset’s paragraph spacing above it. Several blank lines make just one gap.',
      )),

    section('Bold, italic and code',
      example('**bold** or __bold__\n*italic* or _italic_\n***bold italic***\n`code`'),
      list(
        ['⌘B and ⌘I put ', code('**'), ' and ', code('*'), ' around the selection, or take them off.'],
        ['Code wins: nothing inside backticks is styled. Use more backticks to include one: ', code('``a ` b``'), '.'],
        'Emphasis stays on one line; it cannot run across a line break.',
      )),

    section('What stays literal',
      example('2 * 3 = 6\nfile_name_here\n**not closed\n2 \\* 3 \\* 4\nC:\\Users\\notes'),
      list(
        'A marker followed by a space opens nothing, so arithmetic keeps its asterisks.',
        'Underscores inside a word stay: a file name keeps them.',
        'An unclosed marker prints as the characters it is.',
        ['A backslash before punctuation prints that punctuation: ', code('\\*'), ' is an asterisk. Before anything else the backslash stays, so paths survive.'],
      )),

    section('Tables',
      example('| Item   | Qty | Price |\n|--------|:---:|------:|\n| Chairs |  40 | 120.00 |\n| Urn    |  1  |  35.50 |'),
      list(
        'A header row, then a dashed row under it, is what makes a table. Without the dashed row, a line with pipes is just a line.',
        [code(':---'), ' aligns left, ', code(':---:'), ' centres, ', code('---:'), ' aligns right.'],
        'The header prints bold, and it repeats at the top of the next page if the table runs over.',
        ['Rows run until a blank line, a heading or a line with no pipe. The outer pipes are optional; write ', code('\\|'), ' for a pipe inside a cell.'],
      )),

    section('Not part of the dialect',
      example('[a link](https://example.com)\n> a quotation\n- a list item\n```\ncode fence\n```'),
      para('Links, quotations, lists, images and code fences print exactly as typed. That is deliberate: ',
        'a plain-text file should come out on paper looking like itself.')),
  ]
}
