# Packaging LoText as a .app and a .dmg

*2026-09-22*

`npm run dmg` (`scripts/make-dmg.sh`) builds `LoText-<version>.dmg` in the export folder
(`scripts/export-folder.sh`). This is what the
script knows that is not obvious from reading it.

## No packaging dependency

An Electron app bundle is the Electron bundle with the app's files, name and identifiers put
into it. `plutil`, `codesign` and `hdiutil` are already on the machine, so `electron-builder`
would bring a large dependency tree to do the same twenty lines. The whole build is about six
seconds.

The source maps are left out: they are 2MB of the 3MB `dist/` and serve only a debugger.

## Gotcha: codesign refuses a bundle carrying extended attributes

```
LoText.app: resource fork, Finder information, or similar detritus not allowed
```

`cp -R` brings extended attributes across from `node_modules`. `xattr -cr "$APP"` before signing
is what clears it. The error names a resource fork, which is not what is actually there, so it
does not read as an xattr problem.

## Gotcha: a bundle staged in a restricted directory comes out owner-only

Staging under a directory with a restrictive umask or inherited ACLs produced `drwx------` on
the `.app` and `-rwxr-x--x` on the executable. It runs perfectly for whoever built it, so the
mistake is invisible on the machine that made it, and the app is broken for everyone else.
`chmod -RN` (strip ACLs) then `chmod -R go+rX` fixes it. Do it **before** signing — permissions
are covered by the signature.

## Signing is inside-out

A signature covers what is inside the bundle, so every nested helper `.app` and `.framework` is
signed first and the outer bundle last. Signing the outer one first and a helper afterwards
silently invalidates the outer signature.

`--deep` exists but is deprecated; the explicit loop is what the script does.

Verify with `codesign --verify --deep --strict`, and verify the copy **inside the mounted
image**, not the staged one — that is the artifact that ships.

## Releasing: signed and notarized

`npm run dmg` is **ad-hoc signed**: a locally built image is never quarantined, so it opens here
with no complaint, but copy it anywhere — AirDrop, email, a download — and Gatekeeper refuses
it. The image for other people comes from:

```sh
npm run release        # in Terminal on the Mac — never over SSH
```

`scripts/release.sh` checks the setup below and says in plain words what is missing, then runs
`make-dmg.sh` with `LOTEXT_SIGN_IDENTITY` and `LOTEXT_NOTARY_PROFILE` filled in. It signs,
uploads to Apple, waits (a few minutes), staples the ticket to the image, and checks the result
with `spctl`. First done 2026-09-22; `spctl` reported *Notarized Developer ID* for the image and
the app.

### First-time setup (once per Mac)

1. **A Developer ID Application certificate with its private key on this Mac.** Xcode →
   Settings → Accounts → the Lolek Productions team → Manage Certificates → **+** → Developer
   ID Application. Needs the Account Holder role. Check:
   `security find-identity -v -p codesigning` lists
   `Developer ID Application: Lolek Productions, INC. (N6Z9A72885)`.
2. **An app-specific password** at account.apple.com → Sign-In and Security → App-Specific
   Passwords, made while signed in as the developer-team Apple ID.
3. **The saved notary login**, in Terminal on the Mac:
   `xcrun notarytool store-credentials lotext-notary --apple-id <Apple ID> --team-id N6Z9A72885`
   and paste the app-specific password. It answers *Credentials saved to Keychain*.
4. **The first `npm run release`**: when macOS asks whether codesign may use the key, enter the
   login password and choose **Always Allow** — plain Allow asks again for every file.

### Which certificate is which

Three different things are all loosely called "Developer ID", which is most of the confusion:

| Name | What it is | Signs a .dmg for others? |
|---|---|---|
| Apple Developer **account** | the paid membership, team N6Z9A72885 | — |
| **Developer ID Application** | certificate + private key in the login keychain | **yes** — the one |
| Developer ID Application **Managed** | cloud certificate; key on Apple's servers | no — Xcode builds only |
| Apple Distribution | App Store uploads | no |
| Apple Development | your own devices | no |
| Developer ID *Certification Authority* | Apple's intermediate, above yours | no — not yours at all |

One Developer ID certificate signs every app the team makes. Nothing is registered per app:
the bundle identifier is just the string in `package.json`.

### What the signing does

With an identity, every loose Mach-O under `Frameworks/` (the dylibs, `chrome_crashpad_handler`,
`ShipIt`) is signed first, then the helper apps and frameworks, then the app — all with
`--options runtime --timestamp`, and the apps with `packaging/entitlements.plist`. Without the
JIT entitlements V8 cannot run under the hardened runtime, which notarization requires. The
image is signed too, then notarized and stapled. The app inside carries no ticket of its own;
dragged out of the image, it is looked up online on first launch.

### Gotcha: a *Managed* Developer ID certificate cannot be used here

developer.apple.com can list a **Developer ID Application Managed** certificate with its
Download button greyed out. That is a cloud-managed certificate: the private key lives on
Apple's servers and only Xcode, signing an Xcode build, can use it. `codesign` cannot. Create
an ordinary one in Xcode (setup step 1), which puts the key and certificate straight into the
login keychain. Installing `.cer` and `.p12` files never helps here: a `.p12` on hand turned out
to be the Apple Distribution certificate again. This cost hours before it was spotted.

### Gotcha: sign and notarize at the Mac, not over SSH

Over SSH the login keychain stays locked for the session and nothing can prompt for the
password — not codesign's key-access dialog, not `security unlock-keychain`, not
`notarytool store-credentials` or `history` (`keychainLocked`). An agent's shell is the same:
it has no terminal to type a password into. `release.sh` refuses to start over SSH for this
reason. Checking a finished image works fine remotely — `spctl --assess` and
`stapler validate` need no key:

```sh
xcrun stapler validate "$(scripts/export-folder.sh)/LoText-1.0.0.dmg"
spctl --assess --type open --context context:primary-signature -vv "$(scripts/export-folder.sh)/LoText-1.0.0.dmg"
# => accepted  source=Notarized Developer ID
```

### Gotcha: notarytool 401

`HTTP status code: 401. Invalid credentials` from `store-credentials` means the Apple ID and
**app-specific** password (account.apple.com → App-Specific Passwords) do not match. It is not
the certificate.

### Gotcha: `errSecInternalComponent`

codesign fails with this, immediately, when the private key's access control wants to ask
permission and no prompt can be shown — an SSH session, or an agent's shell. Either run the
build once from Terminal on the Mac and choose *Always Allow*, or grant codesign access
directly (asks for the login password):

```sh
security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db
```

## The smoke test that needs no window

```sh
LoText.app/Contents/MacOS/LoText --list-presets     # => "* Default"
```

This loads the packaged main process, reads the settings store and exits, so it proves the
bundled code and its resources actually resolve. `--pdf README.md --out /tmp/x.pdf` goes
further and exercises the print layout; it produced a valid 3-page PDF from the packaged app.

## Opening files from the Finder needs a declaration

The runtime half has always been there: `app.on('open-file')` in `src/main/main.js` hands the
path to `src/main/open-queue.js`. But **macOS only sends that event for types the bundle
declares**, so without `CFBundleDocumentTypes` a double-click or an Open With never reaches the
app at all. The declaration lives in `packaging/document-types.plist` and the script applies it
with `plutil -replace CFBundleDocumentTypes -xml`.

`LSHandlerRank` is `Default`, which claims `.txt`, `.md` and `.toml` (`public.toml`). `Alternate` would put LoText in the
Open With menu without taking the types over.

Check that LaunchServices actually parsed it, rather than trusting the plist:

```sh
LSR=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
"$LSR" -f /path/to/LoText.app
"$LSR" -dump | grep -A2 "claimed UTIs"
# => net.daringfireball.markdown, public.utf8-plain-text, public.plain-text
```

### Gotcha: registering an app to test it cannot be undone

`lsregister -u` on the same path fails with `-10814` and the entries stay in the database. They
are inert once the path is gone — entries on an absent volume do not appear in Open With — but
they accumulate. Only `lsregister -kill -r -domain local -domain system -domain user`, a
machine-wide rebuild, actually clears them. Prefer testing against a copy you intend to keep.

## The icon

`assets/icon.svg` is the master: the Lucide `edit` glyph on a `#3478f6` squircle, 824px of art
centred in a 1024px canvas, which is the macOS grid. See `assets/README.md`.

**Nothing on this machine rasterises SVG** — no rsvg, no Inkscape, and `sips` does not read it.
The PNG is rendered by loading the SVG in a transparent Electron window and calling
`capturePage()`, the same trick the screenshot harness uses. `sips -z` then makes the iconset
and `iconutil -c icns` the `.icns`.

### Gotcha: the Dock caches the icon by bundle identifier

Rebuilding with a new icon under the same `CFBundleIdentifier` can keep showing the old one.
`killall Dock` clears it.
