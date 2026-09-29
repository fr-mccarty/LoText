# Running and driving LoText on iOS

How the iPhone/iPad app is built, run in the simulator and driven from a terminal, and the
traps found doing it. The design is `specs/mobile.md`.

## The loop

```sh
scripts/ios-sim.sh run            # web bundle → cap sync → xcodebuild → install → launch (iPhone 17 Pro)
scripts/ios-sim.sh run pad        # the same on iPad Pro 11-inch (M5)
scripts/ios-sim.sh eval 'return window.__model.openFile?.path'
scripts/ios-sim.sh answer 0       # choose button 0 on the alert / action sheet on screen (-1 Cancel)
scripts/ios-sim.sh shot out.png
scripts/ios-sim.sh docs           # the app's Documents — the LoText folder; drop test files here
```

Like the Mac app, **a rebuild does not reload the running app**: the web bundle is copied into
the `.app`, so `run` reinstalls and relaunches. `launch` relaunches without building.

## How `eval` works

Debug builds only. `MainViewController` polls `tmp/lotext-eval.js` in the app's container every
quarter second, runs it in the page with `callAsyncJavaScript` (so the body may `await` and must
`return`), and writes `{ ok, value | error }` to `tmp/lotext-eval.out`. Release builds compile none
of it (`#if DEBUG`).

`window.__model` is the model, `window.lotext` the bridge; `lotext.sendCommand('save')` is a menu
command. **Synthetic `Touch`/`TouchEvent`s work** in the simulator's WebKit, which is how the
long-press menu was tested:

```js
const row = document.querySelector('[data-path="Shopping.md"]'), b = row.getBoundingClientRect()
const t = new Touch({ identifier: 1, target: row, clientX: b.x + 60, clientY: b.y + 20 })
row.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true }))
```

## Answering native UI

A terminal cannot tap a `UIAlertController`. In Debug builds every alert and action sheet the
plugin raises registers a way to be answered, and `LoTextNative.answer({ index })` (what
`ios-sim.sh answer` calls) dismisses it and resolves the JS call as if that button were tapped.
The document pickers, the print panel and Quick Look have no such hook: relaunch to get rid of
them, and test choosing a folder by hand.

A menu raised from a scripted `.click()` points at the top-left corner, because no real finger
set `lastPointer`. That is the harness, not a bug.

## Traps

- **Build outside `~/Documents`.** Files built under `~/Documents` pick up Finder extended
  attributes, and `codesign` — even the simulator's ad-hoc "Sign to Run Locally" — fails with
  *resource fork, Finder information, or similar detritus not allowed*. The failure is easy to
  miss: an unsigned `App.app` is still left behind, installs, and then `simctl launch` says *The
  request was denied by service delegate (SBMainWorkspace)*. The script builds into
  `~/Library/Developer/Xcode/DerivedData/LoText-ios`; Xcode's own default is also outside.
- **`eval` straight after `launch`** can run before the page has loaded and fail with a stack
  of `@\n@` (a TypeError on `window.__model`). Wait a few seconds after launching.
- **`simctl terminate` is a crash** as far as the app knows: nothing saves. The next launch
  offers the working save back — which is correct, and is the way to test recovery.
- **`navigator.clipboard.readText()` in `eval` hangs the harness.** iOS puts up its Paste
  permission callout and waits for a tap, so that eval never answers and every later one queues
  behind it; `launch` clears it. To see what a cut or copy wrote, replace
  `navigator.clipboard.writeText` for the one eval and record its argument. A scripted key event
  needs the same stub: without a real key press WebKit refuses the write, and ⌘X's whole-line
  cut then (rightly) leaves the text alone.
- **No real hardware keys from a terminal.** This Xcode ships no Simulator.app (DeviceHub.app
  stands in), `simctl io` has no keyboard, and `osascript` is not allowed to send keystrokes
  from this session (error 1002, no Accessibility permission). A keydown dispatched on
  `view.contentDOM` tests everything after iOS hands the key to the page, not the handing-over.
- The simulator's first on-screen keyboard shows iOS's *slide to type* tutorial over the app.
- **Disk.** A simulator build is ~400 MB and a booted simulator writes more. The disk filled up
  once mid-session, after which every command failed with `ENOSPC` and the simulator had to be
  shut down and rebooted before launches worked again. `xcrun simctl shutdown all` and
  deleting `DerivedData/LoText-ios` get the space back.

## What was checked in the simulator

On iPhone 17 Pro (compact) and iPad Pro 11-inch (regular), iOS 26.5, light and dark:
first launch opening the app folder; open, edit, ⌘S and in-place write; save conflict alert;
background saves, foreground picks up changes made elsewhere (open file and tree); crash
recovery offered on relaunch; long-press row menu; Move To…; New File → rename → `.md` added →
editor; Delete; Print (AirPrint panel, page drawn at Letter); Settings sheet, both tabs; Find
File; Recently Edited; Help; the keyboard bar's Tab, task box and undo; ⌘= on a hardware
keyboard; image, .docx and PDF (Quick Look) viewers; Choose Folder… presenting the picker.
Later, on iPhone 17 Pro: long lines one tab, two tabs and four spaces in wrap under their own
text (the hanging indent's tab workaround holds in WebKit); ⌘X, as a scripted keydown, on a
collapsed disclosure takes its hidden lines with it, and one ⌘Z puts them back.
