// A folder on another machine: who to log in as, where to reach it, and which folder there.
//
// This is the remote twin of the path a local window is opened on, and it is what the session
// record keeps. It is plain text, so unlike a grant it can be written down and read back.

export function makeLocation ({ user = '', host, port = null, path = '.' }) {
  const trimmedPath = String(path).trim()
  return {
    user: String(user).trim(),
    host: String(host).trim(),
    port: port ?? null,
    path: trimmedPath || '.',
  }
}

/**
 * The two spellings people actually type: `user@host:/path`, which is what `scp` takes, and
 * `ssh://user@host:port/path`, which is what a browser-shaped field wants. A bare `host:path`
 * logs in as whoever you are here.
 *
 * Null for anything with no host in it, which is the one part that cannot be guessed.
 */
export function parseLocation (text) {
  let rest = String(text ?? '').trim()
  if (!rest) return null

  let port = null
  let path = ''

  const scheme = /^(ssh|sftp):\/\//i.exec(rest)
  if (scheme) {
    rest = rest.slice(scheme[0].length)
    // Everything from the first slash is the path, and it keeps its leading slash:
    // `ssh://host/etc` means `/etc`, the way a URL reads.
    const slash = rest.indexOf('/')
    if (slash >= 0) { path = rest.slice(slash); rest = rest.slice(0, slash) }
  } else {
    const colon = pathColon(rest)
    if (colon >= 0) { path = rest.slice(colon + 1); rest = rest.slice(0, colon) }
  }

  let user = ''
  const at = rest.lastIndexOf('@')
  if (at >= 0) { user = rest.slice(0, at); rest = rest.slice(at + 1) }

  // A port on the authority, which only the URL spelling can carry unambiguously: in
  // `host:/path` the colon introduces the path, and that case has already been taken above.
  const portColon = rest.lastIndexOf(':')
  if (portColon >= 0) {
    const number = Number(rest.slice(portColon + 1))
    if (Number.isInteger(number)) { port = number; rest = rest.slice(0, portColon) }
  }

  if (!rest || rest.includes(' ')) return null
  return makeLocation({ user, host: rest, port, path })
}

/**
 * The colon that separates `host` from `path` in the `scp` spelling — the *last* one, so that
 * `user@host:2222:/path` is not mistaken for a path beginning `2222`, and none at all when
 * what follows is a number and nothing else.
 */
function pathColon (text) {
  const colon = text.lastIndexOf(':')
  if (colon < 0) return -1
  const after = text.slice(colon + 1)
  if (!after || /^\d+$/.test(after)) return -1
  return colon
}

/**
 * The address a remembered location is reconnected by: the `scp` spelling, or the URL one
 * when there is a port to carry. `parseLocation` reads it back as the same location.
 */
export function address (location) {
  const authority = target(location)
  return location.port
    ? `ssh://${authority}:${location.port}${location.path.startsWith('/') ? '' : '/'}${location.path}`
    : `${authority}:${location.path}`
}

/** What `ssh` is handed: `user@host`, or just `host` when the user was left out. */
export function target (location) {
  return location.user ? `${location.user}@${location.host}` : location.host
}

/**
 * The folder's name, for the sidebar's header and the window's title. The last component of
 * the remote path, and the host itself for a path with no component of its own — `/` and `.`
 * both name a folder whose only useful name is the machine it is on.
 */
export function displayName (location) {
  const parts = location.path.split('/').filter(Boolean)
  const last = parts[parts.length - 1]
  if (!last || last === '.' || last === '~') return location.host
  return last
}

/**
 * One line naming this exact folder on this exact machine. It is the window's folder key, the
 * tree's expansion key, and what the Recent Servers list matches on — so it has to be spelled
 * the same way every time, which is why the port is written only when there is one.
 */
export function identity (location) {
  const authority = location.port ? `${target(location)}:${location.port}` : target(location)
  return `ssh://${authority}/${location.path}`
}

/** What the user sees on a list row and in an error: short, and still unambiguous. */
export function label (location) {
  return `${displayName(location)} — ${target(location)}`
}
