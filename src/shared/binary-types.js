// The one place the binary-file denylist lives, so the sidebar's greying and the open path
// can never disagree.
//
// It is a **denylist, not an allowlist**: a file is openable unless its extension is a known
// binary type, which is why `README`, `Makefile`, `LICENSE`, and every other extensionless or
// unusual-but-textual file opens.
//
// Binary no longer means unshowable. The set below is assembled from the viewers' own type
// lists plus the opaque remainder rather than written out a third time, because a list
// maintained in two places is a list that will one day disagree with itself: adding a type to
// a viewer is what takes it out of the editor, in one edit.

/** `NSImage`'s job, done by an `<img>`: drawn at its own size, never enlarged past 1:1. */
export const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'heic', 'webp', 'tiff', 'bmp', 'ico', 'icns',
])

export const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'aac', 'flac'])

export const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v'])

export const PDF_EXTENSIONS = new Set(['pdf'])

// Word processors and rich text — the formats whose *words* are the document. These go to a
// selectable plain-text view rather than to a rendered picture of a page, so `⌘A` and `⌘C`
// can get the words out. For a letter the words are the document, and being able to see one
// without being able to quote a line of it is half an answer.
export const WORD_PROCESSING_EXTENSIONS = new Set(['docx', 'rtf', 'odt'])

// Spreadsheets, presentations and the iWork formats: the ones where the *layout* is the
// document and there is nothing sensible to pour into a text view.
export const RENDERED_DOCUMENT_EXTENSIONS = new Set([
  'xlsx', 'pptx', 'pages', 'numbers', 'key',
])

export const DOCUMENT_EXTENSIONS = new Set([
  ...WORD_PROCESSING_EXTENSIONS, ...RENDERED_DOCUMENT_EXTENSIONS,
])

export const PREVIEWABLE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS,
  ...PDF_EXTENSIONS, ...DOCUMENT_EXTENSIONS,
])

// Binary, and nothing can be made of it on screen either — an archive, a font, a compiled
// object. These rows stay dimmed and inert.
export const OPAQUE_EXTENSIONS = new Set([
  // archives
  'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar',
  // disk images and installers
  'dmg', 'pkg',
  // fonts
  'ttf', 'otf', 'woff', 'woff2',
  // compiled output and databases
  'o', 'a', 'dylib', 'so', 'bin', 'exe', 'sqlite', 'db',
  // The older Microsoft binary formats. Their readable half is a proprietary compound
  // document, and a viewer that opened one onto an empty pane would be worse than a row
  // saying plainly that there is nothing here to show.
  'doc', 'xls', 'ppt',
  // Video containers whose codecs the platform frequently cannot decode, for the same
  // reason: a player that opens onto a black rectangle is a worse answer than a dimmed row.
  'avi', 'mkv',
])

export const BINARY_EXTENSIONS = new Set([...PREVIEWABLE_EXTENSIONS, ...OPAQUE_EXTENSIONS])

/**
 * The extension of `filename`, lowercased, or null when it has none.
 * A leading dot is part of the name, not an extension, so `.gitignore` has none.
 */
export function fileExtension (filename) {
  const name = filename.startsWith('.') ? filename.slice(1) : filename
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = name.slice(dot + 1)
  return ext ? ext.toLowerCase() : null
}

/** Filename only — never reads contents. Case-insensitive extension match. */
export function isBinary (filename) {
  const ext = fileExtension(filename)
  return ext ? BINARY_EXTENSIONS.has(ext) : false
}

/** Which viewer a name goes to, or null when nothing here can show it. */
export function viewerFor (filename) {
  const ext = fileExtension(filename)
  if (!ext) return null
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (AUDIO_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) return 'media'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (WORD_PROCESSING_EXTENSIONS.has(ext)) return 'documentText'
  if (RENDERED_DOCUMENT_EXTENSIONS.has(ext)) return 'rendered'
  return null
}

export function isPreviewable (filename) {
  return viewerFor(filename) !== null
}

/** True for a file with no picture in it: a transport bar, not a black rectangle. */
export function isAudioOnly (filename) {
  const ext = fileExtension(filename)
  return ext ? AUDIO_EXTENSIONS.has(ext) : false
}

/**
 * What a row can be done with. Three answers rather than two: a file the editor refuses may
 * still be one the detail pane can show, and only the third is the dimmed, inert row.
 *
 * Text wins over previewable where both could apply, because the editor is what this app is.
 */
export function openability (filename, isFolder) {
  if (isFolder) return 'opaque'
  if (!isBinary(filename)) return 'text'
  if (isPreviewable(filename)) return 'previewable'
  return 'opaque'
}
