// UTF-8 decoding and encoding for the editor buffer, and the one place line endings are
// decided. This sits *above* the file store: the store trades in bytes, and turning bytes into
// text happens once, here, instead of at every place that reads a file.
//
// The buffer always holds LF line endings so the editor behaves; the file's own ending is
// carried alongside the text and restored on encode. A file read and saved untouched is
// byte-for-byte the same file. That's the test.

import { notUTF8 } from './store/errors.js'

/**
 * Decodes UTF-8 and reports the file's dominant line ending.
 *
 * A file whose endings are mixed picks the ending that occurs most often (ties go to LF);
 * only that ending survives a save, so a mixed-ending file is normalized to its dominant
 * ending rather than preserved run for run. A uniform file — the normal case — round-trips
 * byte for byte.
 *
 * A leading UTF-8 byte-order mark is kept as a U+FEFF character at the head of the text,
 * because dropping it would change the file's bytes.
 *
 * Throws rather than substituting replacement characters: a file that is not valid UTF-8 is
 * refused, and that is the real binary backstop behind the extension denylist.
 */
export function decode (data, relativePath) {
  const hasBOM = data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF
  const body = hasBOM ? data.subarray(3) : data
  let decoded
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    throw notUTF8(relativePath)
  }
  const lineEnding = dominantLineEnding(data)
  let text = hasBOM ? '﻿' + decoded : decoded
  if (lineEnding === 'crlf' || decoded.includes('\r\n')) text = text.replace(/\r\n/g, '\n')
  return { text, lineEnding }
}

/** Encodes the buffer as UTF-8 bytes (a Uint8Array), rewriting its LF endings as `lineEnding`. */
export function encode (text, lineEnding) {
  const normalized = text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text
  const out = lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized
  return new TextEncoder().encode(out)
}

/**
 * Counts line breaks over the raw bytes — no string scan, and no dependence on how the
 * runtime groups CR LF into one character.
 */
function dominantLineEnding (data) {
  let crlf = 0
  let bareLF = 0
  let previous = 0
  for (const byte of data) {
    if (byte === 0x0A) {
      if (previous === 0x0D) crlf += 1
      else bareLF += 1
    }
    previous = byte
  }
  return crlf > bareLF ? 'crlf' : 'lf'
}
