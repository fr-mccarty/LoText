// The program that runs on the other machine.
//
// It is one POSIX shell script, sent as the command on every connection and handed a verb and
// its arguments — `sh -c '<this>' lotext list /home/me/notes`. One script rather than a command
// per operation, because each operation is then exactly one round trip and the whole remote
// vocabulary can be read in one place.
//
// Nothing is assumed of the far side beyond a POSIX shell and the tools every Unix has: `stat`,
// `cat`, `mkdir`, `mv`, `cp`, `rm`. There is no agent to install and nothing left behind.
// `stat` is the one tool whose flags differ between the two worlds — GNU's `-c` against BSD's
// `-f` — so the script asks once, at the top, which one it is talking to. It asks rather than
// tries-and-falls-back, because GNU's `-f` is a valid flag meaning something else entirely.
//
// Links are followed — `stat -L` — so a link to a folder is listed as a folder, which is the
// same answer the local store gives for the same thing.
//
// Two limits, both inherent to a line-based protocol and both harmless in practice: a file
// whose name contains a newline is not listed, and the mtimes are whole seconds. Whole seconds
// are enough because every stamp a remote folder is compared against came from the same place.

/** Exit codes. Anything else is the shell's own — 127 for a missing tool, 255 for ssh itself. */
export const STATUS = {
  noSuchFolder: 3,
  notFound: 4,
  nameTaken: 8,
  conflict: 9,
  writeFailed: 10,
  badVerb: 64,
}

export const SOURCE = `
LXV="$1"; shift
if stat -c %Y . >/dev/null 2>&1; then LXS=gnu; else LXS=bsd; fi
lx_many() {
  if [ "$LXS" = gnu ]; then stat -L -c '%Y|%s|%F|%n' -- "$@"
  else stat -L -f '%m|%z|%HT|%N' -- "$@"; fi
}
lx_one() {
  if [ "$LXS" = gnu ]; then stat -L -c '%Y|%s|%F' -- "$1"
  else stat -L -f '%m|%z|%HT' -- "$1"; fi
}
lx_free() {
  base=$1; ext=''
  case "$1" in ?*.*) base=\${1%.*}; ext=.\${1##*.} ;; esac
  candidate=$1; n=2
  while [ -e "$candidate" ] || [ -L "$candidate" ]; do
    candidate="$base $n$ext"; n=$((n+1))
  done
  printf '%s' "$candidate"
}
case "$LXV" in
hello)
  cd -- "$1" 2>/dev/null || exit 3
  [ -d . ] || exit 3
  pwd
  ;;
list)
  cd -- "$1" 2>/dev/null || exit 3
  # Dot names too: whether they show is View > Show Hidden Files, decided by the app. A pattern
  # that matched nothing stays as itself and is dropped by the test.
  set -- * .[!.]* ..?*
  for lx_name do
    shift
    if [ -e "$lx_name" ] || [ -L "$lx_name" ]; then set -- "$@" "$lx_name"; fi
  done
  if [ "$#" -eq 0 ]; then exit 0; fi
  lx_many "$@" 2>/dev/null
  exit 0
  ;;
stat)
  lx_one "$1" 2>/dev/null || exit 4
  ;;
stamps)
  lx_many "$@" 2>/dev/null
  exit 0
  ;;
exists)
  if [ -e "$1" ] || [ -L "$1" ]; then exit 0; else exit 4; fi
  ;;
read)
  [ -f "$1" ] || exit 4
  lx_one "$1" 2>/dev/null || exit 4
  cat -- "$1"
  ;;
write)
  dst=$1; want=$2
  if [ "$want" != '-' ]; then
    now=$(lx_one "$dst" 2>/dev/null) || exit 4
    if [ "\${now%%|*}" != "$want" ]; then printf '%s\\n' "$now"; exit 9; fi
  fi
  tmp="$dst.lotext-part.$$"
  cat > "$tmp" || { rm -f "$tmp"; exit 10; }
  cat "$tmp" > "$dst" || { rm -f "$tmp"; exit 10; }
  rm -f "$tmp"
  lx_one "$dst" 2>/dev/null || exit 10
  ;;
create)
  kind=$1
  cd -- "$2" 2>/dev/null || exit 3
  name=$(lx_free "$3")
  if [ "$kind" = folder ]; then mkdir -- "$name" || exit 10
  else : > "$name" || exit 10; fi
  printf '%s\\n' "$name"
  ;;
copy)
  [ -e "$1" ] || [ -L "$1" ] || exit 4
  src=$1
  cd -- "$2" 2>/dev/null || exit 3
  name=$(lx_free "$3")
  cp -R -- "$src" "$name" || exit 10
  printf '%s\\n' "$name"
  ;;
move)
  [ -e "$1" ] || [ -L "$1" ] || exit 4
  if [ -e "$2" ] || [ -L "$2" ]; then exit 8; fi
  mv -- "$1" "$2" || exit 10
  ;;
delete)
  rm -rf -- "$1" || exit 10
  ;;
*)
  exit 64
  ;;
esac
`

/**
 * One line of `stat` output, whichever flavour produced it. The name is taken as everything
 * after the third separator, so a `|` in a filename survives; the type is normalized here,
 * where GNU's "directory" and BSD's "Directory" become the same answer.
 */
export function parseEntry (line) {
  const fields = splitLimited(line, '|', 4)
  if (fields.length !== 4) return null
  const seconds = Number(fields[0])
  const size = Number(fields[1])
  if (!Number.isFinite(seconds) || !Number.isFinite(size) || !fields[3]) return null
  return {
    stamp: { modified: seconds * 1000, size },
    isFolder: fields[2].toLowerCase().includes('directory'),
    name: fields[3],
  }
}

/** The three-field form, from `stat` and `read`: no name, because the caller already knows. */
export function parseStamp (line) {
  const fields = splitLimited(line, '|', 3)
  if (fields.length < 2) return null
  const seconds = Number(fields[0])
  const size = Number(fields[1])
  if (!Number.isFinite(seconds) || !Number.isFinite(size)) return null
  return { modified: seconds * 1000, size }
}

function splitLimited (text, separator, limit) {
  const parts = []
  let rest = text
  while (parts.length < limit - 1) {
    const index = rest.indexOf(separator)
    if (index < 0) break
    parts.push(rest.slice(0, index))
    rest = rest.slice(index + 1)
  }
  parts.push(rest)
  return parts
}

/** Single-quoted for `sh`, with the one escape that spelling needs. */
export function quoted (text) {
  return `'${String(text).replace(/'/g, `'\\''`)}'`
}
