// THE COMMAND LINE — the same printer, no window.
//
//   lotext --pdf notes.md --out notes.pdf --preset "Letterhead" --paper a4
//   lotext --pdf - --name notes.md < notes.md > notes.pdf      ← `-` is stdin/stdout
//   lotext --list-presets
//
// Same parser, same layout, same drawing code as ⌘P — a PDF from a shell script and a sheet
// from a printer are the same pages. It exits before there is a window, a folder, or a Dock
// icon.

import path from 'node:path'
import { promises as fs } from 'node:fs'
import * as Settings from './settings.js'
import { writePDF } from './print/printer.js'
import { PAPER_SIZES } from '../shared/settings-shape.js'
import { decode } from '../shared/text-coding.js'

export function isCommandLineJob (argv) {
  return argv.includes('--pdf') || argv.includes('--list-presets')
}

export async function runCommandLine (argv) {
  const options = parse(argv)

  if (options.listPresets) {
    for (const preset of Settings.presets()) {
      const mark = preset.id === Settings.activePresetID() ? '*' : ' '
      process.stdout.write(`${mark} ${preset.name}\n`)
    }
    return 0
  }

  const preset = Settings.presetNamed(options.preset)
  if (!preset) {
    process.stderr.write(`No preset is called “${options.preset}”.\n`)
    return 1
  }
  if (options.paper && !PAPER_SIZES[options.paper]) {
    process.stderr.write(`Paper must be one of: ${Object.keys(PAPER_SIZES).join(', ')}.\n`)
    return 1
  }

  let text
  let fileName = options.name ?? 'Untitled'
  if (options.input === '-') {
    text = decode(await readStdin(), fileName).text
  } else {
    const source = path.resolve(options.input)
    text = decode(await fs.readFile(source), source).text
    fileName = options.name ?? path.basename(source)
  }

  const destination = options.out ?? '-'
  await writePDF({
    text,
    settings: Settings.printSnapshot(preset),
    fileName,
    folderName: options.input === '-' ? '' : path.basename(path.dirname(path.resolve(options.input))),
    paper: options.paper ?? preset.paper ?? 'letter',
  }, destination)
  return 0
}

function parse (argv) {
  const options = { listPresets: false, input: null, out: null, preset: null, paper: null, name: null }
  const args = argv.slice(1)
  for (let index = 0; index < args.length; index += 1) {
    switch (args[index]) {
      case '--list-presets': options.listPresets = true; break
      case '--pdf': options.input = args[index += 1]; break
      case '--out': options.out = args[index += 1]; break
      case '--preset': options.preset = args[index += 1]; break
      case '--paper': options.paper = args[index += 1]; break
      case '--name': options.name = args[index += 1]; break
      default: break
    }
  }
  return options
}

function readStdin () {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)))
    process.stdin.on('error', reject)
  })
}
