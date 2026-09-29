# screencapture from a remote session (ssh / mosh / tmux)

*2026-09-22, Joshs-Mac-mini (Apple M4, macOS 25.6.0)*

## Symptom

Every screen capture from this session failed with:

```
could not create image from display
```

`screencapture` plain, under `osascript do shell script`, and under
`sudo launchctl asuser 501` all failed identically.

## The environment that causes it

This session is reached remotely, so the process chain has no GUI identity:

```
sshd  ->  mosh-server  ->  zsh  ->  tmux server (parent PID 1)  ->  claude  ->  shell
```

```sh
launchctl managername     # => Background   (NOT Aqua)
env | grep SSH_CLIENT     # => 100.x.y.z ... (Tailscale)
```

A `Background` session has no WindowServer connection. The tmux server is
daemonized, so the terminal emulator is not even an ancestor.

## What it was NOT — all of these were ruled out

Don't re-chase these; each was checked and came back clean.

| Suspect | Check | Result |
|---|---|---|
| No display attached | `system_profiler SPDisplaysDataType` | 1920x1080, Main, Online |
| Display asleep | `ioreg -c IOMobileFramebuffer -r -d1` | `CurrentPowerState=1` = on |
| Screen locked | `ioreg -n Root -d1 -a` -> `IOConsoleUsers` | no `CGSSessionScreenIsLocked` key = unlocked |
| Missing TCC grant | see query below | `/usr/sbin/screencapture` already `2` (allowed) |
| Terminal needs permission | — | iTerm is not in the ancestry at all |

```sh
sqlite3 "/Library/Application Support/com.apple.TCC/TCC.db" \
  "select service,client,auth_value from access where service='kTCCServiceScreenCapture';"
# auth_value: 0 = denied, 2 = allowed
```

Granting Screen Recording to iTerm or tmux does nothing here.

## Root cause

**TCC attributes a capture to the *responsible process*, not to the binary.**

The responsible process resolves up the parent chain to sshd/mosh, which holds
no Screen Recording grant — so the grant already recorded for
`/usr/sbin/screencapture` never applies. `launchctl asuser` switches the audit
session but does **not** reparent the process, so it does not help.

## The fix: let launchd spawn it

launchd is the responsible process, which severs the ssh ancestry. **No sudo
and no sudoers rule is required** — `gui/501` is reachable as the same user.

### Hard constraint: no wrapper script

The plist must exec `/usr/sbin/screencapture` **directly**. Wrapping it in a
shell script fails with the same error, because `bash` then becomes the
responsible process and `bash` has no grant. This is why the helper below
regenerates the plist on every call instead of using a fixed wrapper.

## Working helper

```bash
#!/bin/bash
# Capture the console display from a remote (ssh/mosh/tmux) session.
# launchd must exec /usr/sbin/screencapture DIRECTLY: TCC attributes the
# capture to the responsible process, and any wrapper script becomes that
# process (and is denied). So we rewrite the agent's plist per invocation.
set -euo pipefail
LABEL=com.jmccarty.shot
PLIST="${TMPDIR:-/tmp}/$LABEL.plist"
[ $# -eq 0 ] && set -- -x /tmp/claude-shot.png
{
  printf '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n'
  printf '<key>Label</key><string>%s</string>\n' "$LABEL"
  printf '<key>ProgramArguments</key><array>\n'
  printf '<string>/usr/sbin/screencapture</string>\n'
  for a in "$@"; do
    printf '<string>%s</string>\n' "$(printf '%s' "$a" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g')"
  done
  printf '</array>\n<key>RunAtLoad</key><false/>\n'
  printf '<key>StandardErrorPath</key><string>/tmp/claude-shot.err</string>\n'
  printf '</dict></plist>\n'
} > "$PLIST"
: > /tmp/claude-shot.err
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
for _ in $(seq 20); do [ -s /tmp/claude-shot.err ] && break; sleep 0.2; done
if [ -s /tmp/claude-shot.err ]; then cat /tmp/claude-shot.err >&2; exit 1; fi
```

Usage:

```sh
shot                                       # full screen -> /tmp/claude-shot.png
shot -x -R 100,100,600,400 /tmp/crop.png   # any screencapture args
```

Verified: full screen 3.4 MB 1920x1080, and a 600x400 region crop.

## Caveats

- Captures the **console display** — what is physically on the Mac mini's
  screen, not the remote terminal.
- Errors surface in `/tmp/claude-shot.err`; the job exits 0 even on failure,
  so check that file rather than the exit code.
- A wrong `-R` rect gives `could not create image from rect` — a *different*
  message from the TCC failure, and a useful signal that the mechanism works.
- Unrelated but recorded: `com.googlecode.iterm2` is `auth_value 0`
  (explicitly **denied**, not merely ungranted). Local captures from iTerm
  will fail until that is flipped in System Settings.
