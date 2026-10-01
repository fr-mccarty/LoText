# iCloud sync: settings and reading positions

Optional, off until turned on: Settings ▸ either tab ▸ iCloud ▸ **Sync settings and reading
positions**, on the Mac and on iPhone/iPad. Code: `src/shared/sync/cloud-sync.js` (both
platforms), `src/main/cloud.js` (Mac), `src/mobile/cloud.js` + `ios/App/App/LoTextNative+Cloud.swift`
(iOS). Tests: `test/cloud-sync.test.js`.

## What travels

- **The Editor tab**, key by key (`view.*`, an allowlist from `DEFAULT_VIEW`).
- **The print presets and the selected one**, as one unit — a list cannot be merged by key.
  A preset is a whole layout design: margins, paper, fonts, spacing, the letterhead text, and
  its **header and footer images**, which live inside the preset as data URLs (shrunk to 1600px
  on the long side when chosen, at most 3 MB each). So an image chosen on the iPhone prints on
  the Mac, and an exported settings file carries it too.
- **Where each document was left**: the selection and the line at the top of the pane. Only for
  documents with a name both devices share: those in iCloud Drive, by the path below
  `Mobile Documents/`, e.g. `icloud:com~apple~CloudDocs/Notes/a.md` (on the Mac, `~/Documents`
  and `~/Desktop` count when Desktop & Documents is on — iCloud Drive holds links to them), and
  those in a folder on a server, by its address and the file (`ssh:ssh://user@host/path/a.md`).
  Everything else is remembered on the device only (`local:` keys).
- **The saved servers** — Connect to Server's list — one entry per address, newest wins. A
  server saved on one device is listed on the other; each device still logs in with its own key
  (`specs/mobile.md`), so nothing secret travels.

Reopening a file restores its position whether or not sync is on — a deliberate departure from
Lolext, where every open starts at the top. Positions are noted when leaving a file, when the
window loses focus (on iOS, going to the background), and when the window closes. A move or
rename loses the position.

## Where it lives

`Sync/<deviceID>.json` in the iCloud container `iCloud.com.lolekproductions.lotext`. Each device
writes only its own file and reads the others', so iCloud never makes a conflicted copy. Every
synced value carries the time it was set; newest wins, per key.

- **iOS** has the iCloud Documents entitlement (`ios/App/App/App.entitlements`) and reaches the
  container through `url(forUbiquityContainerIdentifier:)`, with file coordination and a metadata
  query that downloads other devices' files and reports changes.
- **The Mac** has no iCloud entitlement (Developer ID, no sandbox). It writes the container's
  directory, `~/Library/Mobile Documents/iCloud~com~lolekproductions~lotext/`, which iCloud Drive
  puts on every Mac of the account once the container exists — i.e. after the iOS app has used
  it. Until then the Mac says "Waiting for iCloud". **If the Mac app is ever sandboxed, this
  stops working** and needs an entitlement and provisioning profile instead.

Lolext syncs through `NSUbiquitousKeyValueStore` (Lolext `icloud-settings.md`). LoText cannot:
Electron has no native access to it, and positions would outgrow its 1 MB.

## Rules

- Turning it on takes the settings already in iCloud; what nobody has set yet is published
  from this device. If iCloud is unreachable at that moment, this happens when it next answers.
- A value from another device goes through the settings store's normalisers
  (`applySynced`), and is recorded in `cloud.mirror` first, so it is not sent back as a change.
- A device writes its file only when its content changed; the watchers on both sides would
  otherwise loop.
- Refreshed at launch, when the app comes forward, and when the folder changes (the Mac's
  `fs.watch`, iOS's metadata query). Written a second after a change, and on quit / background.
- Turning it off stops reading and writing; the device's file stays in iCloud and its values
  stay where they are.
