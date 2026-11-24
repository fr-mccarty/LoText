# Publishing the Mac download

How the Mac app is exported as a disk image, where the images are kept, and how a new one
replaces the download on [lolekproductions.org/LoText](https://lolekproductions.org/LoText).
The iPhone/iPad app is not part of this: it is archived and uploaded in Xcode
(`packaging/app-store/ios.md`).

## 1. Exporting the disk image

There are two exports. Only the second is ever published.

| Command | Signed with | Opens on |
|---|---|---|
| `npm run dmg` | an ad-hoc signature | this Mac only. Copied anywhere else (a download, AirDrop, email), Gatekeeper refuses it. |
| `npm run release` | the Developer ID Application certificate, then notarized by Apple | any Mac |

Both build the app, put it in a disk image with an Applications shortcut, and check the result.
`npm run release` also uploads the image to Apple for notarization, waits for the answer (a few
minutes), and staples the ticket to the image.

**Run `npm run release` in Terminal at the Mac itself.** It needs the login keychain, which is
locked over SSH and in an agent's shell; the script refuses to start there. The one-time setup
(certificate, app-specific password, saved notary login) and what to do when signing fails are
in `discoveries/packaging-a-dmg.md`.

### Before exporting: the version

The version comes from `"version"` in `package.json`. It names the file and the mounted volume,
and it is the version the app reports. Raise it before a release that will be published, so the
new image never has the same name as the one already on the site.

### Where the images are kept

- **Each export** is written to `LoText-<version>.dmg` in the export folder, replacing a file
  of the same name. The export folder is set in one place, `scripts/export-folder.sh`, and
  running that script prints it. It is outside this project, in iCloud Drive, so the images are
  on every Mac while the project itself stays out of iCloud. Older versions stay there beside it. To write it somewhere else, pass a
  path: `npm run release -- ~/somewhere/LoText.dmg`.
- **The published image** is the copy in the websites' download folder on the Mac mini
  (section 2 below).

None of these is in git. Older exports can stay in the export folder; only the site is limited
to the latest version (section 2).

### Checking an image

These need no keychain, so they work from anywhere, SSH included. Run them from the project
folder and put your version in place of `1.0.2`:

```sh
xcrun stapler validate "$(scripts/export-folder.sh)/LoText-1.0.2.dmg"
# => The validate action worked!
spctl --assess --type open --context context:primary-signature -vv "$(scripts/export-folder.sh)/LoText-1.0.2.dmg"
# => accepted  source=Notarized Developer ID
```

An image that fails either check must not be published: people who download it will be told it
cannot be opened.

## 2. Publishing it on lolekproductions.org

lolekproductions.org is served by Peru from the Mac mini (`jmccarty@mac-mini` on the
tailnet), through a Cloudflare tunnel, out of `~/peru-2-agent/websites/current`. That folder is
built from the Peru checkout `~/peru-2` by **`pnpm websites:install`**, which builds every public
website, copies in the download folder, and switches the new build in at once (older builds are
kept beside it). `pnpm deploy` is Peru's server on the droplet and does not touch the public
websites. `scripts/peru.sh` holds these names, and reaches the Mac mini over ssh from any other
Mac (set `LOTEXT_PERU_HOST` / `LOTEXT_PERU_DIR` to point elsewhere).

**The site offers one version only: the latest.** When publishing is done, the download folder
holds exactly one LoText image, the one the page links to. Older versions are not kept on the
site; they stay in the export folder.

### Where the files live (on the Mac mini)

| What | Where |
|---|---|
| The published image (one, the latest) | `~/peru-2-agent/websites/downloads/lolekproductions/LoText-<version>.dmg` |
| Its public address | `https://lolekproductions.org/LoText-<version>.dmg` |
| The page that links to it | `~/peru-2/behavior/code/frontend/web/src/websites/lolekproductions/lolekproductions-website.tsx` |
| The try-it editors' code | `~/peru-2/behavior/code/frontend/web/public/websites/lolekproductions/lotext-playground.{js,css}` |
| The page as people see it | [lolekproductions.org/LoText](https://lolekproductions.org/LoText) |

Nothing in the download folder or the page is live until `pnpm websites:install` runs. Each
build carries its own copy of the page and the image, so the live site never links to an image
that has been taken away. Cloudflare keeps files for up to four hours, so a change may take
that long to reach everyone unless the cache is purged in Cloudflare.

### Publishing from the release

`npm run release` asks, once the image is exported:

```
Publish it on lolekproductions.org? [y/N]
```

A `y` runs `scripts/publish-to-website.sh`, which does the steps below in order and stops at the
first that fails. Before rebuilding the websites it lists any other website commits on Peru's
`main` that are not yet live, since the rebuild puts them live too, and asks again. The answer is
no unless you type `y`. To decide in advance, run `npm run release -- --publish` or
`npm run release -- --no-publish`. An `npm run dmg` image is never offered: it is not notarized.

To publish an image already made, run the script on it:

```sh
scripts/publish-to-website.sh LoText-1.0.3.dmg
```

A bare name is looked for in the export folder; a path is used as it is.

It refuses an image that is not notarized, and a version the site already offers from a
different image. If it stops partway, running it again finishes the job: an image already copied
is not copied again, and a page change already committed is not committed twice. The page's date
is the day it is published.

### Steps

These are what the script does, for doing it by hand on the Mac mini. The examples publish
version 1.0.9 in place of 1.0.8. Put your own versions in their place.

1. **Copy the notarized image into the download folder.**

   ```sh
   scp "$(scripts/export-folder.sh)/LoText-1.0.9.dmg" jmccarty@mac-mini:peru-2-agent/websites/downloads/lolekproductions/
   ```

2. **Point the page at it.** In `lolekproductions-website.tsx`, change the file name and the
   line under the button:

   ```tsx
   const lotextDiskImageFileName = 'LoText-1.0.9.dmg'
   …
   <span className="text-xs font-normal opacity-75">Version 1.0.9 · November 17, 2026</span>
   ```

   The file name must match the copied file exactly. If the new version needs a different
   macOS, also update the line below the button ("macOS 11 Big Sur or later") and the answer in
   the page's questions that says the same. Commit the change on `main` in `~/peru-2` and push.

3. **Remove the old image** from the download folder, so the latest is the only version on the
   site, keeping a copy in the export folder if there is none there. This step is not optional.
   The live site is unaffected: its build has its own copy.

4. **Rebuild the websites:** `cd ~/peru-2 && pnpm websites:install`. It prints the build that
   is now current.

5. **Check the live page.** Open lolekproductions.org/LoText, confirm the button shows the new
   version, and download it. The image should open without a Gatekeeper warning.

## 3. The try-it editors

The editors on lolekproductions.org/LoText run LoText's own editor code (`src/web/`). After a
change to anything they show (task boxes, enhanced tasks, arrows, the hanging indent, Tab,
⌥↑ / ⌥↓, ⌘X), run:

```sh
scripts/update-website-editor.sh
```

It builds the editor for the web, copies it into Peru on the Mac mini, commits and pushes it
there, runs `pnpm websites:install` (listing any other website commits it would put live, and
asking first), and checks the site serves the new build.
