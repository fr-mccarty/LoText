// The two pieces of the Windows build that need Node rather than the shell. See make-windows.sh.
//
//   node scripts/windows-exe.mjs electron <arch>           prints the path of Electron's Windows zip
//   node scripts/windows-exe.mjs brand <LoText.exe> <out.ico>
//                                                          gives the exe LoText's icon and version
//
// Branding the exe is what electron-builder does with rcedit, which is a Windows program and so
// needs Wine on a Mac — Intel-only Wine at that. resedit edits the same resources from plain
// JavaScript, so the whole Windows build runs on this Mac with nothing emulated.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import * as ResEdit from 'resedit'

const require = createRequire(import.meta.url)
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..')
const pkg = require(path.join(ROOT, 'package.json'))

const [command, ...args] = process.argv.slice(2)

if (command === 'electron') {
  // The same download `npm install` makes for the Mac, and the same cache: the version is the
  // one in node_modules, so the Windows app is never a different Electron from the Mac one.
  const { downloadArtifact } = require('@electron/get')
  const version = require(path.join(ROOT, 'node_modules/electron/package.json')).version
  const zip = await downloadArtifact({ version, platform: 'win32', arch: args[0] ?? 'x64', artifactName: 'electron' })
  process.stdout.write(zip + '\n')
} else if (command === 'brand') {
  const [exePath, icoPath] = args
  writeFileSync(icoPath, icoFromPng(path.join(ROOT, 'assets/icon-1024.png')))
  brand(exePath, icoPath)
} else {
  console.error('usage: windows-exe.mjs electron <arch> | brand <exe> <out.ico>')
  process.exit(1)
}

/**
 * A Windows icon is a directory of images, one per size Explorer may ask for. Since Vista each
 * may be a PNG as it stands, so the sizes are cut from the Mac's 1024-pixel icon with `sips`
 * and written into the directory unchanged.
 */
function icoFromPng (source) {
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'lotext-ico-'))
  try {
    const images = sizes.map((size) => {
      const out = path.join(scratch, `${size}.png`)
      execFileSync('sips', ['-z', String(size), String(size), source, '--out', out], { stdio: 'ignore' })
      return { size, data: readFileSync(out) }
    })
    const header = Buffer.alloc(6)
    header.writeUInt16LE(0, 0)                  // reserved
    header.writeUInt16LE(1, 2)                  // 1 = icon
    header.writeUInt16LE(images.length, 4)
    let offset = 6 + 16 * images.length
    const entries = images.map(({ size, data }) => {
      const entry = Buffer.alloc(16)
      entry.writeUInt8(size >= 256 ? 0 : size, 0) // 0 means 256
      entry.writeUInt8(size >= 256 ? 0 : size, 1)
      entry.writeUInt16LE(1, 4)                 // colour planes
      entry.writeUInt16LE(32, 6)                // bits per pixel
      entry.writeUInt32LE(data.length, 8)
      entry.writeUInt32LE(offset, 12)
      offset += data.length
      return entry
    })
    return Buffer.concat([header, ...entries, ...images.map(({ data }) => data)])
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Electron's icon swapped for LoText's, and the Properties ▸ Details tab saying what it is. */
function brand (exePath, icoPath) {
  // Electron's exe is signed by its makers; any edit breaks that signature, so it is ignored
  // on the way in. LoText's exe goes out unsigned.
  const exe = ResEdit.NtExecutable.from(readFileSync(exePath), { ignoreCert: true })
  const resources = ResEdit.NtExecutableResource.from(exe)

  const icon = ResEdit.Data.IconFile.from(readFileSync(icoPath))
  const group = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)[0]
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries, group.id, group.lang, icon.icons.map((item) => item.data))

  const [major, minor = 0, patch = 0] = pkg.version.split('.').map(Number)
  const info = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)[0]
  const lang = { lang: 1033, codepage: 1200 }
  info.setStringValues(lang, {
    ProductName: pkg.productName,
    FileDescription: pkg.productName,
    CompanyName: 'Lolek Productions, Inc.',
    LegalCopyright: `© ${new Date().getFullYear()} ${pkg.author}`,
    InternalName: pkg.productName,
    OriginalFilename: `${pkg.productName}.exe`,
    ProductVersion: pkg.version,
    FileVersion: pkg.version,
  })
  info.setFileVersion(major, minor, patch, 0, 1033)
  info.setProductVersion(major, minor, patch, 0, 1033)
  info.outputToResourceEntries(resources.entries)

  resources.outputResource(exe)
  writeFileSync(exePath, Buffer.from(exe.generate()))
}
