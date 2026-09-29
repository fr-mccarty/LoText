// Puts back what `contextBridge` strips from an error on its way into the window.
//
// An `Error` crossing from the preload script arrives with its message and nothing else: the
// `code` and `current` the model decides on (`conflict`, `notFound`, `noTrash`, …) are gone,
// and every failure looked like a plain "could not". So the preload rejects with a plain object,
// which is copied whole, and it is made an `Error` again here. The iOS bridge lives in the page
// and throws real errors, which pass through untouched.

/**
 * A copy of the bridge with every function wrapped, not a Proxy: the preload's object is frozen,
 * and a Proxy may not answer a frozen property with anything but the property itself. Only that
 * frozen object is copied; the iOS bridge is not frozen, has properties added to it later, and
 * has no errors to mend.
 */
export function restoringErrors (bridge) {
  if (!Object.isFrozen(bridge)) return bridge
  const copy = {}
  for (const key of Object.keys(bridge)) {
    const value = bridge[key]
    copy[key] = typeof value !== 'function' ? value : (...args) => {
      const result = value.apply(bridge, args)
      return typeof result?.then === 'function' ? result.then(undefined, (reason) => { throw asError(reason) }) : result
    }
  }
  return copy
}

export function asError (reason) {
  if (reason instanceof Error || reason?.code === undefined) return reason
  const error = new Error(reason.message ?? 'Something went wrong.')
  error.code = reason.code
  error.current = reason.current ?? null
  return error
}
