# LoText for Android — Google Play listing

Draft of what goes in Play Console. The character limits are Google's. The App Store listing is
`../app-store/metadata.md`; what Android leaves out (Connect to Server, iCloud sync, Send to
DayCap) is in README ▸ Building for Android, so none of it is promised here.

## Main store listing — in fastlane

The name, short description (80), full description (4000), icon and release notes are files in
`fastlane/metadata/android/en-US/`: `title.txt`, `short_description.txt`, `full_description.txt`,
`images/icon.png`, `changelogs/<versionCode>.txt`. Edit them there; `fastlane listing` sends them.

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
- **Website:** _optional — lolekproductions.org_
- **Privacy policy URL:** _the same one as the App Store listing — fill in_

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

## Graphics still needed

- [ ] **App icon:** 512 × 512 PNG, 32-bit, up to 1 MB (from `assets/icon-ios-1024.png`).
- [ ] **Feature graphic:** 1024 × 500 PNG or JPEG — required.
- [ ] **Phone screenshots:** 2–8, 16:9 or 9:16, each side 320–3840 px (`scripts/android.sh shot`
      gives 1080 × 2400 from the Medium Phone AVD).
- [ ] **Tablet screenshots** (7" and 10"): optional, but needed to be featured on tablets.

## Before the first upload

- [ ] Upload key, then `scripts/android.sh release` for the .aab.
- [ ] Raise `versionCode` in `android/app/build.gradle` on every upload; `versionName` is "1.0" now.
- [ ] New personal developer accounts must run a closed test with at least 12 testers for 14 days
      before production access is granted.
