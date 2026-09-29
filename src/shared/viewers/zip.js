// Just enough of the zip container to read one entry out of it. The office and iWork formats
// are all zips with XML or a picture inside, and this is the smallest thing that can open one
// without taking on a dependency to do it.
//
// Bytes are a Uint8Array, so the same reader runs in the Mac's main process and in the iOS web
// view. Inflating is the one thing the two do differently — Node's zlib there,
// `DecompressionStream` here — so it is handed in as `inflateRaw(bytes) → Promise<bytes>`.
//
// Nothing here renders anything, and nothing here writes a file.

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_FILE_HEADER = 0x02014b50

function view (bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** Every entry's name and where its bytes are, read from the central directory. */
export function readDirectory (bytes) {
  const data = view(bytes)
  const end = findEndRecord(bytes, data)
  if (end < 0) return []
  const count = data.getUint16(end + 10, true)
  let offset = data.getUint32(end + 16, true)
  const entries = []
  const decoder = new TextDecoder('utf-8')

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > bytes.length) break
    if (data.getUint32(offset, true) !== CENTRAL_FILE_HEADER) break
    const method = data.getUint16(offset + 10, true)
    const compressedSize = data.getUint32(offset + 20, true)
    const nameLength = data.getUint16(offset + 28, true)
    const extraLength = data.getUint16(offset + 30, true)
    const commentLength = data.getUint16(offset + 32, true)
    const localOffset = data.getUint32(offset + 42, true)
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    entries.push({ name, method, compressedSize, localOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** One entry's bytes, inflated if it needs to be. Null for anything this cannot read. */
export async function readEntry (bytes, entry, inflateRaw) {
  const data = view(bytes)
  const local = entry.localOffset
  if (local + 30 > bytes.length) return null
  const nameLength = data.getUint16(local + 26, true)
  const extraLength = data.getUint16(local + 28, true)
  const start = local + 30 + nameLength + extraLength
  const body = bytes.subarray(start, start + entry.compressedSize)
  try {
    if (entry.method === 0) return body.slice()
    if (entry.method === 8) return await inflateRaw(body)
  } catch {
    return null
  }
  return null
}

/** The first entry whose name matches, read out whole. */
export async function readNamed (bytes, predicate, inflateRaw) {
  const entry = readDirectory(bytes).find((item) => predicate(item.name))
  return entry ? readEntry(bytes, entry, inflateRaw) : null
}

export async function readAll (bytes, predicate, inflateRaw) {
  const entries = readDirectory(bytes)
    .filter((entry) => predicate(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const read = []
  for (const entry of entries) {
    const data = await readEntry(bytes, entry, inflateRaw)
    if (data) read.push({ name: entry.name, data })
  }
  return read
}

function findEndRecord (bytes, data) {
  const floor = Math.max(0, bytes.length - 66_000)
  for (let index = bytes.length - 22; index >= floor; index -= 1) {
    if (data.getUint32(index, true) === END_OF_CENTRAL_DIRECTORY) return index
  }
  return -1
}
