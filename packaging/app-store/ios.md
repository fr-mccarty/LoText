# LoText for iPhone and iPad — shipping to the App Store

What the iOS app needs to get from this folder to the App Store, in order. The Mac listing is
`metadata.md`; the design is `specs/mobile.md`; driving the simulator is
`discoveries/running-lotext-on-ios.md`.

**Signing can only happen at the Mac**, in Xcode, with the keychain unlocked — the same as
`npm run release` (CLAUDE.md). Everything below marked *you* is that.

## Decided in the project

    Bundle ID            com.lolekproductions.lotext — the same as the Mac app
    Team                 N6Z9A72885 (automatic signing)
    Deployment target    iOS 17.0, iPhone and iPad
    Version / build      1.3 (9)   — MARKETING_VERSION / CURRENT_PROJECT_VERSION in the target
    Category             public.app-category.productivity
    Encryption           ITSAppUsesNonExemptEncryption = NO, so no export question per upload.
                         Connect to Server's SSH encrypts, but only through Apple's CryptoKit
                         (swift-crypto re-exports it on iOS), which Apple counts as "encryption
                         limited to that within the Apple operating system" — no documentation.
                         Holds only while no package brings its own crypto (BoringSSL, OpenSSL,
                         _CryptoExtras, Citadel). Check a build: `otool -L` shows CryptoKit.framework
                         and `nm -gU` finds no BoringSSL symbols
    Privacy manifest     ios/App/App/PrivacyInfo.xcprivacy — file timestamps (3B52.1, C617.1),
                         user defaults (CA92.1); no tracking, nothing collected
    iCloud               iCloud Documents, container iCloud.com.lolekproductions.lotext
                         (ios/App/App/App.entitlements) — settings sync, specs/icloud-sync.md.
                         Signing & Capabilities must show it ticked; if the container is red,
                         press + there once so automatic signing registers it
    Files app            UIFileSharingEnabled + LSSupportsOpeningDocumentsInPlace, so the app's
                         folder shows as On My iPhone ▸ LoText
    Icon                 assets/icon-ios-1024.png — full bleed, no alpha (iOS rounds it)

**One bundle ID for both platforms means one App Store record and universal purchase**: one
listing, one price, bought once for Mac, iPhone and iPad. If the iPhone app should be a
separate listing, change the bundle ID (e.g. `com.lolekproductions.lotext.ios`) in the target
and in `capacitor.config.json` **before the first upload** — it cannot be changed after.

## Each release

1. Bump **Version** (and **Build**, which must rise on every upload) on the App target's
   General tab.
2. **From a terminal** (Claude can do this): unlock the keychain
   (`security unlock-keychain ~/Library/Keychains/login.keychain-db`, typed by you), then
   `scripts/ios-upload.sh` archives and uploads, and steps 3–4 are done. Otherwise:
   `npm run ios:open` — builds the web half, copies it into the project, opens Xcode.
3. *You:* destination **Any iOS Device (arm64)**, then **Product ▸ Archive**.
4. *You:* Organizer ▸ **Distribute App ▸ App Store Connect ▸ Upload**. Let Xcode manage signing.
5. *You:* in App Store Connect, add the build to **TestFlight** and install it on a real iPhone
   and iPad before submitting. The list in `tasks/remaining.md` ▸ iOS is what the simulator
   could not check.

## The listing (App Store Connect ▸ iOS)

Reuse `metadata.md`'s name, subtitle, category, age rating and privacy answer ("Data Not
Collected"). The iOS text differs:

**Promotional text:**
A quiet plain-text editor for iPhone and iPad. Open a folder, pick a file, write. Markdown
headings, tables and emphasis print beautifully with your own presets.

**Description** — replace the Mac's sections with:

    FOLDER BASED
    • Work in any folder Files can reach: On My iPhone, iCloud Drive, or another app's storage.
    • Create, rename, duplicate, move and delete files and folders in the sidebar.
    • Find File jumps to any file by name; Recently Edited brings back what you just worked on.

    MADE FOR TOUCH, AND FOR A KEYBOARD
    • A bar above the keyboard with Tab, tasks, bold, italic, undo and redo.
    • With a keyboard on iPad, the Mac's shortcuts: ⌘S, ⌘N, ⇧⌘P, ⌘F, ⌘B, ⌘I and more.
    • Side by side on iPad; one pane at a time on iPhone.

    PRINTING THAT LOOKS FINISHED
    • Markdown headings, paragraphs, tables and emphasis print as a properly set page.
    • Print presets hold your margins, letterhead, headers, footers and page numbers.
    • Print with AirPrint, or share the page as a PDF.

    SAFE WITH YOUR TEXT
    • Saves when you leave a file or the app, and checks first that nothing else changed it.
    • Unsaved changes are kept safe if the app closes unexpectedly.

    No account, no subscription, no tracking. Just your text.

**Keywords:** text editor,markdown,plain text,notes,writing,folder,print,txt,md,tasks,ipad,minimal

**Review notes:**
LoText needs no account. On first launch it opens its own folder (On My iPhone ▸ LoText); tap
the folder button at the top left to choose another folder with the system picker. Tap a file to
edit it; long-press a file for its menu. Print and Share PDF are in the ⋯ menu above the text.

## Screenshots

Required: **iPhone 6.9"** (1320 × 2868 — the iPhone 17 Pro Max simulator's own size) and
**iPad 13"** (2064 × 2752 — iPad Pro 13-inch (M5)). `scripts/ios-sim.sh shot` takes them at
exactly those sizes; `scripts/ios-sim.sh docs` is where to put the files they show.
