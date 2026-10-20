# Filling in Play Console with Claude

Play Console is a website with no API for most of its forms, so a Claude session with a browser
(Claude in Chrome, or the Claude desktop app's built-in browser) fills it in, signed in as the
developer account owner. Paste the prompt below into that session. The answers themselves are in
`listing.md`; this is only the order to enter them in and what to stop for.

What it uploads:

- The signed bundle: `~/Documents/LoText-exports/LoText-<version>-android.aab`, made by
  `scripts/android.sh release` on the M5 MacBook Pro (the export folder is
  `scripts/export-folder.sh`). Bundles are build output and never committed.
- The listing text and icon: `fastlane/metadata/android/en-US/`.
- The feature graphic and screenshots, once made: `~/Documents/LoText-exports/play-store-graphics/`.

## The prompt

```
Fill out the Google Play Console listing for my Android app LoText, using Claude in Chrome
(or the built-in browser). I'm already signed in to Play Console as the developer account owner.

Source of truth — read these first, on this Mac:
- ~/code/LoText/packaging/play-store/listing.md  — every answer: app details, App content
  (ads, app access, target audience, content rating, data safety, government/financial/health/news),
  release notes, graphics checklist
- ~/code/LoText/fastlane/metadata/android/en-US/  — title.txt, short_description.txt,
  full_description.txt, images/icon.png, changelogs/1.txt
- The signed bundle to upload: ~/Documents/LoText-exports/LoText-1.0.8-android.aab
  (package com.lolekproductions.lotext, versionCode 1, versionName 1.0)

Do, in order:
1. Create app: name "LoText", default language English (United States), App, Free.
   Stop and show me the declarations (Developer Program Policies, US export laws) — I tick those myself.
2. Test and release ▸ Testing ▸ Internal testing: create a release, keep Google-managed
   app signing (the default), upload the .aab above, release name "1.0 (1)", release notes
   from changelogs/1.txt. Add me (fr.mccarty@gmail.com) as a tester via a new email list.
   Save it, then stop and show me the review screen before rolling it out.
3. Main store listing: paste title, short and full description from the fastlane files,
   upload images/icon.png as the app icon. Feature graphic and phone screenshots:
   if they exist in ~/Documents/LoText-exports/play-store-graphics/, upload them;
   otherwise leave those fields and tell me.
4. Store settings: category App ▸ Productivity, tags per listing.md, contact email
   fr.mccarty@gmail.com, website https://lolekproductions.org/LoText.
5. Policy ▸ App content:
   - Privacy policy: https://lolekproductions.org/LoText/privacy
   - Answer every other section exactly as listing.md says (no ads; all functionality
     available without access; target audience 18+; content rating questionnaire category
     "Utility, Productivity, Communication, or Other", every answer No; data safety:
     collects/shares no user data; not a government, financial, health or news app).

Rules:
- Never pay, accept agreements, or publish/roll out to any track without asking me first.
- Don't promote anything to production. Closed/production testing comes later.
- If a page asks something listing.md doesn't answer, stop and ask me rather than guessing.
- When done, list what's complete, what's still missing (Dashboard ▸ "Set up your app"),
  and update the checkboxes in listing.md; don't commit.
```

For a later release, change the bundle's file name, the release name and the changelog number
(the new `versionCode`), and skip steps 1 and 3–5 — or, once the service account is set up, use
`fastlane internal` instead.

## Before it is accurate for Android

The privacy policy at that URL is written for the Mac app ("your Mac", the macOS open panel,
Electron). Nothing in it is untrue for Android, which collects nothing either, but a paragraph on
Android belongs there; the page is in the `peru` site repo.
