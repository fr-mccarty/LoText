// The vocabulary every store speaks, local or remote. A caller above the door decides what to
// say to the user; below it, a failure is one of these.

export class StoreError extends Error {
  constructor (code, message, detail) {
    super(message)
    this.name = 'StoreError'
    this.code = code
    this.detail = detail
  }
}

/** Nothing is written and the buffer stays dirty: the file moved underneath us. */
export function conflict (current) {
  const error = new StoreError('conflict', 'The file changed on disk.')
  error.current = current
  return error
}

export const notFound = (path) =>
  new StoreError('notFound', `“${path}” is no longer there.`)

export const nameTaken = (name) =>
  new StoreError('nameTaken', `Something called “${name}” is already there.`)

export const notUTF8 = (path) =>
  new StoreError('notUTF8', `“${path}” is not valid UTF-8 text, so it cannot be opened here.`)

export const folderUnavailable = () =>
  new StoreError('folderUnavailable', 'The folder is unavailable.')

/** Carried across IPC as a plain object; rebuilt on the far side. */
export function describeError (error) {
  if (error instanceof StoreError) {
    return { code: error.code, message: error.message, current: error.current ?? null }
  }
  return { code: 'failed', message: error?.message ?? String(error), current: null }
}
