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
- **A copy on the Desktop** is made only if you want one. When the export finishes, the script
  asks `Copy it to the Desktop? [y/N]`; the answer is no unless you type `y`. To decide in
  advance, run `npm run release -- --desktop` or `npm run release -- --no-desktop`. A run with no
  terminal to ask in, such as an agent's, makes no copy.
- **The published image** is the copy in `~/peru/storage/lolekproductions-org-downloads/`
  (step 2 below).

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

lolekproductions.org is served by Peru (`~/peru`). Publishing a new version means putting the
image where the site serves files from, and pointing the LoText page at it.

**The site offers one version only: the latest.** When publishing is done, the storage folder
holds exactly one LoText image, the one the page links to. Older versions are not kept on the
site; they stay in the export folder.

### Where the files live

| What | Where |
|---|---|
| The published image (one, the latest) | `~/peru/storage/lolekproductions-org-downloads/LoText-<version>.dmg` |
| Its public address | `https://lolekproductions.org/api/public/websites/lolekproductions/published-documents/file?path=LoText-<version>.dmg` |
| The page that links to it | `~/peru/frontend/src/pages/websites/lolekproductions/pages/lotext.tsx` |
| The page as people see it | [lolekproductions.org/LoText](https://lolekproductions.org/LoText) |

A file put in the storage folder is downloadable at once. The live site reads that same folder
(`~/peru-main/storage` is a symlink to `~/peru/storage`). A change to the page goes live only
with a Peru deploy.

### Publishing from the release

`npm run release` asks, after the Desktop question:

```
Publish it on lolekproductions.org? [y/N]
```

A `y` runs `scripts/publish-to-website.sh`, which does the steps below in order and stops at the
first that fails. Before deploying Peru it lists any other commits on Peru's `main` that are not
yet live, since the deploy puts them live too, and asks again. The answer is no unless you type
`y`. To decide in advance, run `npm run release -- --publish` or `npm run release -- --no-publish`.
An `npm run dmg` image is never offered: it is not notarized.

To publish an image already made, run the script on it:

```sh
scripts/publish-to-website.sh LoText-1.0.3.dmg
```

A bare name is looked for in the export folder; a path is used as it is.

It refuses an image that is not notarized, and a version the site already offers from a
different image. If it stops partway, running it again finishes the job: a page change already
committed is not committed twice, and once the version is live only the removal of older images
is left. The page's date is the day it is published.

### Steps

These are what the script does, for doing it by hand. The examples publish version 1.0.2 in
place of 1.0.0. Put your own versions in their place.

1. **Copy the notarized image into the storage folder.** Leave the old one there for now: the
   live page links to it until the deploy.

   ```sh
   cp "$(scripts/export-folder.sh)/LoText-1.0.2.dmg" ~/peru/storage/lolekproductions-org-downloads/
   ```

2. **Check that the site serves it.** `206` means it is reachable:

   ```sh
   curl -s -r 0-15 -o /dev/null -w "%{http_code}\n" \
     "https://lolekproductions.org/api/public/websites/lolekproductions/published-documents/file?path=LoText-1.0.2.dmg"
   ```

3. **Point the page at it.** In `lotext.tsx`, change `LOTEXT_PUBLISHED_RELEASE` near the top:

   ```ts
   const LOTEXT_PUBLISHED_RELEASE = {
     version: "1.0.2",
     releaseDate: "September 27, 2026",
   } as const;
   ```

   `version` sets the download's file name (`LoText-<version>.dmg`, so it must match the copied
   file exactly) and both lines of the download button: `Download LoText-<version>.dmg`, and
   under it "Version <version> · <releaseDate>". If the new version needs a different macOS, also
   update the line below the button ("macOS 11 Big Sur or later"). Commit the change on `main` in
   `~/peru`.

4. **Deploy Peru.** The process is described in
   `~/peru/skills/manage-peru/references/deploying.md`.

5. **Check the live page.** Open lolekproductions.org/LoText, confirm the button shows the new
   version, and download it. The image should open without a Gatekeeper warning.

6. **Remove the old image** from the storage folder, so the latest is the only version on the
   site. This step is not optional. Do it only after the deploy: removing it earlier would break
   the live download. Then check that one image is left:

   ```sh
   ls ~/peru/storage/lolekproductions-org-downloads/
   # => LoText-1.0.2.dmg  README.md
   ```

The folder's `README.md` is for whoever publishes into it and is never shown on the site. Leave
it in place.
