// "Show invisibles" for a flat, uniform buffer: spaces and tabs get a faint background so they
// can be seen and counted, which is the whole feature. Nothing else is styled — no syntax
// highlighting, no heading sizes, no per-line anything — and the characters in the buffer are
// never altered, so the text saved is exactly the text read.

import { Decoration, ViewPlugin, MatchDecorator } from '@codemirror/view'

const tint = Decoration.mark({ class: 'lo-invisible' })

const matcher = new MatchDecorator({
  regexp: /[ \t]+/g,
  decoration: tint,
})

export const invisibles = ViewPlugin.fromClass(class {
  constructor (view) {
    this.decorations = matcher.createDeco(view)
  }

  update (update) {
    this.decorations = matcher.updateDeco(update, this.decorations)
  }
}, { decorations: (plugin) => plugin.decorations })
