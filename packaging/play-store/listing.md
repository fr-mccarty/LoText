# LoText for Android — Google Play listing

Draft of what goes in Play Console. The character limits are Google's. The App Store listing is
`../app-store/metadata.md`; what Android leaves out (Connect to Server, iCloud sync, Send to
DayCap) is in README ▸ Building for Android, so none of it is promised here.

## Main store listing — in fastlane

The name, short description (80), full description (4000), icon and release notes are files in
`fastlane/metadata/android/en-US/`: `title.txt`, `short_description.txt`, `full_description.txt`,
`images/icon.png`, `changelogs/<versionCode>.txt`. Edit them there; `fastlane listing` sends them.

## Filling in Play Console

`console-prompt.md` is the prompt for a Claude session with a browser to enter all of this in
Play Console, and says where the signed bundle is.

## Uploading with fastlane

Once, by hand — the API cannot do these:

1. Play Console ▸ **Create app** (name LoText, App, Free), and accept the declarations.
2. Upload one build by hand (`scripts/android.sh release`, then Testing ▸ Internal testing): Play
   only takes the package name `com.lolekproductions.lotext` once a bundle has carried it.
3. Google Cloud Console ▸ the project linked to Play ▸ enable **Google Play Android Developer
   API** ▸ IAM ▸ Service accounts ▸ create one ▸ Keys ▸ Add key ▸ JSON. Save it as
   `~/.config/lotext/play-store-key.json` (or point `PLAY_KEY` at it). Never in the repo.
4. Play Console ▸ **Users and permissions** ▸ invite the service account's email, with access to
   LoText and the release and store-listing permissions.

Then, from `LoText/`:

```sh
fastlane check       # the key reaches Play Console
fastlane listing     # text and icon → the store listing (no build)
fastlane internal    # android/app/build/outputs/bundle/release/app-release.aab → internal, as a draft
```

## App details

- **Category:** App ▸ Productivity
- **Tags:** Text editor, Notes, Productivity (pick from Play's list; up to 5)
- **Contact email:** fr.mccarty@gmail.com
- **Website:** https://lolekproductions.org/LoText
- **Privacy policy URL:** https://lolekproductions.org/LoText/privacy

## App content (Policy ▸ App content)

- **Ads:** No, the app does not contain ads.
- **App access:** All functionality is available without special access.
- **Target audience:** 18 and over (avoids the Families policy; widen it only on purpose).
- **Content rating (IARC):** category "Utility, Productivity, Communication, or Other";
  every questionnaire answer No → rated Everyone / PEGI 3.
- **Data safety:**
  - Does the app collect or share any of the required user data types? **No.**
  - Files stay on the device, in the folder the user picks; LoText has no analytics, accounts or
    servers. (The manifest asks for INTERNET because Capacitor's web view does; nothing is sent.)
- **Government app / financial features / health:** No.
- **News app:** No.

## Release notes (What's new, 500 per language)

First release of LoText on Android.

## Graphics

All in `fastlane/metadata/android/en-US/images/`, where `fastlane listing` looks for them.

- [x] **App icon:** `icon.png`, 512 × 512 (from `assets/icon-ios-1024.png`).
- [x] **Feature graphic:** `featureGraphic.png`, 1024 × 500. Its source is `feature-graphic.html`
      here: render it with headless Chrome at 1024 × 500 —
      `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new
      --hide-scrollbars --force-device-scale-factor=1 --window-size=1024,500
      --allow-file-access-from-files --screenshot=featureGraphic.png file://$PWD/feature-graphic.html`.
- [x] **Phone screenshots:** `phoneScreenshots/1_files.png` … `5_find_file.png`, 1080 × 2400 from
      the Medium Phone API 37 AVD (`scripts/android.sh shot`), 2026-10-20. The notes in them are
      `screenshot-notes/`, copied into the app's own folder (`adb push`, then `run-as
      com.lolekproductions.lotext cp -r … files/Documents/`). The status bar is Android's demo mode:
      `adb shell settings put global sysui_demo_allowed 1`, then `am broadcast -a
      com.android.systemui.demo -e command clock -e hhmm 0941` (and `battery`, `network`,
      `notifications -e visible false`; `-e command exit` to leave).
- [ ] **Tablet screenshots** (7" and 10"): optional, but needed to be featured on tablets.

No dark-mode screenshot: in dark mode the status bar's clock and icons stay dark on the app's
black background.

## The upload key

Play App Signing holds the key users' devices see; this upload key only proves a bundle came from
us, and Play Console can reset it if it is lost.

**Where it is:** made 2026-10-20 on the **M5 MacBook Pro** ("Josh's MacBook Pro",
`Joshs-MacBook-Pro`, macOS 27.0.1), the Mac Android releases are built on. Not on JAM-MBP---2021,
the M1 Pro where the Android app was first written.

- The key: `~/.config/lotext/upload.jks`, alias `upload`, valid until 2054. Certificate
  `CN=Josh McCarty, O=Lolek Productions, L=Murray, ST=Kentucky, C=US`, SHA-256
  `91:25:E5:51:A3:BF:68:EC:3E:A7:40:A4:4A:ED:48:D6:53:B8:2E:B8:6A:FE:7C:BA:A9:49:4A:CB:8B:58:9E:5F`
  — Play Console ▸ App signing shows the same upload certificate fingerprint.
- Its password: in `android/keystore.properties` on that Mac only (gitignored), and in the
  password manager.
- Building on another Mac means copying both files there; nothing else needs the key.
- Lost key or password: Play Console ▸ Test and release ▸ App integrity ▸ App signing ▸ request an
  upload key reset. Apps already installed are unaffected.

It was made once, outside the repo, with Android Studio's own keytool (`/usr/bin/keytool` needs a
system Java, which this Mac does not have):

```sh
mkdir -p ~/.config/lotext
"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" -genkeypair -v \
  -keystore ~/.config/lotext/upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
chmod 600 ~/.config/lotext/upload.jks
```

`android/app/build.gradle` signs the release bundle with it when `android/keystore.properties`
(gitignored) exists:

```properties
storeFile=/Users/jmccarty/.config/lotext/upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

Without that file `scripts/android.sh release` still builds, unsigned, and says so.

## Before the first upload

- [x] Upload key (above) — 2026-10-20, on the M5 MacBook Pro.
- [x] `scripts/android.sh release` for the .aab — signed, 2026-10-20.
- [ ] Raise `versionCode` in `android/app/build.gradle` on every upload; `versionName` is "1.0" now.
- [ ] New personal developer accounts must run a closed test with at least 12 testers for 14 days
      before production access is granted.
