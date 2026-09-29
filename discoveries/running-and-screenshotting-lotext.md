# Running, driving, and screenshotting LoText

*2026-09-22*

## Build

`npm run build` emits five bundles into `dist/` in well under a second:
`main.js` (100.8kb), `preload.js` (4.6kb), `renderer.js` (782.4kb),
`settings.js` (20.9kb), `print-window.js` (30.0kb), each with a source map.

## Driving the app: the screenshot harness, and how to get it back

The repo **used** to carry its own screenshot harness — `startShotHarness()` in
`src/main/main.js`, gated on a `LOTEXT_SHOT` environment variable. It was
always marked temporary and was removed once the UI work it existed to verify
had landed. Nothing in the app depends on it.

It is written down here because it is the right way to drive this app and
because it will be wanted again. Prefer it over installing Playwright: it needs
no extra dependency and is unaffected by remote-session limitations, since
`capturePage()` renders in-process rather than reading the screen.

To bring it back, add the call at the end of the `whenReady` block in
`src/main/main.js` and the function beside it:

```js
if (process.env.LOTEXT_SHOT) { startShotHarness() }

async function startShotHarness () {
  const { BrowserWindow: BW } = await import('electron')
  const fs = await import('node:fs/promises')
  const steps = (process.env.LOTEXT_SHOT_STEPS || '').split(',').filter(Boolean)
  setTimeout(async () => {
    const win = BW.getAllWindows()[0]
    if (!win) return
    if (process.env.LOTEXT_SHOT_FOLDER) {
      await win.webContents.executeJavaScript(
        `window.__model.adopting(() => window.lotext.adoptFolder(${JSON.stringify(process.env.LOTEXT_SHOT_FOLDER)}))`)
    }
    for (const step of steps) {
      await win.webContents.executeJavaScript(step).catch((e) => console.log('STEP FAIL', step, e.message))
      await new Promise((r) => setTimeout(r, 700))
    }
    await new Promise((r) => setTimeout(r, 900))
    const image = await win.capturePage()
    await fs.writeFile(process.env.LOTEXT_SHOT, image.toPNG())
    console.log('SHOT WRITTEN')
    app.quit()
  }, 2500)
}
```

Then:

```sh
LOTEXT_SHOT=/path/out.png \
LOTEXT_SHOT_FOLDER=/path/to/folder \
LOTEXT_SHOT_STEPS='window.__model.open("notes.md"),window.__model.showSheet("findFile")' \
  ./node_modules/.bin/electron .
```

It prints `SHOT WRITTEN` and quits. Steps are JS evaluated in the renderer,
comma-separated, 700ms apart.

Useful renderer entry points (`window.__model` is set in
`src/renderer/index.js`):

- `model.open("relative/path.md")` — paths are **store-relative**, `""` is
  the root (`src/shared/file-path.js`), not absolute disk paths.
- `model.showSheet("findFile" | "recentFiles" | "connect")`

### Without touching `src/`: a harness appended to a copy of `dist/`

*2026-09-25.* Copy `package.json` and `dist/` to a scratch folder, symlink `node_modules`, and
append a snippet to the copy's `dist/main.js` that, 2.5s after `app.whenReady()`, `require`s a
driver module named by an env var and calls it with the main window, then `app.quit()`s. The
driver is plain Node in the main process, so it can use commas, `await`, `sendInputEvent`
mouse clicks at coordinates read from `getBoundingClientRect()`, `webContents.insertText()` for
typing (CodeMirror sees it as `input.type`), `webContents.undo()` (what the Undo menu role
calls; `webContents.redo()` did nothing here), and `capturePage()`. The editor is
`window.__model.editor.view`. Run `electron .` from the copy.

**`webContents.undo()` does nothing until the page has typed something.** It is Chromium's own
undo, which fires CodeMirror's `historyUndo` only when Chromium's native stack is non-empty. After
a fresh open, an arrow or box click alone (a dispatch, not native typing) is in CodeMirror's
history but `webContents.undo()` skips it; once anything has been `insertText`-ed it works.
`window.__model.editor.undo()` always does. The Undo menu item is `role: 'undo'`, so ⌘Z in the
real app probably has the same gap. *(2026-09-25)*

**The app saves the file** when it quits or switches away, so a fixture edited by one run is
what the next run opens. Copy the fixture over the test file at the start of every run.

### Gotcha: a step cannot contain a comma

Steps are split on `,`, so `console.log("a", b)` becomes two broken steps. Use
string concatenation, or put the expression in an environment variable of its
own and evaluate that in one step.

### Gotcha: capturing the Settings window

The harness captures `BW.getAllWindows()[0]`, which is the main window. To
capture the settings panel, copy `dist/` aside, patch the copy to call
`openSettingsWindow()` and capture that window instead, and run
`electron /path/to/copy`.

**The patch must come after the folder adoption and after the steps loop.** If
it lands before, `window.__model.adopting(...)` runs against the Settings
window, where `__model` is undefined; that `executeJavaScript` has no `.catch`,
and the unhandled rejection kills the callback so `app.quit()` never runs and
the process hangs forever. Rebuild the copy from a fresh `dist/` with a single
clean patch rather than layering patches. This has cost three sessions so far.

Watch the alias too: the bundled harness binds `node:fs/promises` to a
generated name (`fs8`, `fs9`, …) that **shifts as the bundle grows**. Patched
code should import its own rather than reuse it.

### Gotcha: the harness is timing-dependent

It hardcodes `setTimeout(..., 2500)` before acting and 700ms per step. Fine
on this machine; it could flake on a slower one.

### Gotcha: one instance at a time

`main.js` calls `requestSingleInstanceLock()`. Launching the GUI and a CLI
command concurrently makes one of them quit with
`Failed to create .../SingletonSocket: File exists`. Run them one at a time.

## Gotcha: captures read darker than the screen

Earlier notes here blamed unreadable captures — near-white text on white — on
the harness. Half of that was a real bug and is fixed: `src/renderer/style.css`
had no `color-scheme: light dark`, so `Canvas`, `Field` and `Highlight`
resolved to their *light* values whatever the system appearance was, and the
detail pane painted white under the dark scheme's near-white text. Declaring
the schemes made the system colours follow the appearance, and captures are
legible now.

What remains is a genuine artifact, and a milder one. The windows are
transparent so the native material shows through (`src/main/window.js:105`):

```js
backgroundColor: '#00000000',
vibrancy: 'sidebar',
visualEffectState: 'followWindow',
```

`capturePage()` renders the web layer only and never composites that backdrop,
so every surface in a capture sits about **11 levels of grey darker** than the
same pixel on screen: the window background captures as `#121212` where the
screen shows `#1d1d1d`, and a settings card as `#191919` against `#242424`.

The consequence for measuring against `examples/`: **relative** readings are
trustworthy — geometry, which of two surfaces is lighter, whether a colour is
saturated, and any opaque fill such as an accent or a selection, which comes
out exact. **Absolute** greys are not, and a capture will always miss a
reference's grey by roughly that constant.

Painting a background as the first step is still useful when an opaque capture
is wanted — it removes the offset by removing the transparency:

```
LOTEXT_SHOT_STEPS='document.body.style.background="#1e1e1e",window.__model.open("notes.md")'
```

## Headless CLI paths

Both work with no window and exit 0:

```sh
electron . --list-presets                              # => "* Default"
electron . --pdf notes.md --out notes.pdf              # valid 1-page PDF
```

## Fixed: canvas measured in pixels, the layout drew in points

**Symptom:** a visible gap before and after every `**bold**` or `*italic*` span
in printed output, with the rest of the line pushed right. Plain lines looked
fine.

**Cause:** `src/main/print/print-window.js` measured with a canvas, which
answers in **CSS pixels**, while the whole layout — margins, run `x`, font
sizes, the `pt` units the page is drawn with — is in **points**. CSS fixes
1in = 96px and 1pt = 1/72in, so every measured width was 4/3 too large. Its own
comment said "Canvas metrics, in points", and the `lineHeight` fallbacks
(`font.size * 1.0`) were already points — the units were mixed inside one
function.

Bold did not cause it, it only *revealed* it: a line is one single run until a
style changes, and a single run starts at x=0, where the error is invisible.
Line spacing was inflated by the same 33%.

**Not** in `inline.js` or `layout.js` — both were verified correct first:

```
parseInline: ["A folder-based editor: "|0, "one window..."|BOLD, ", and"|0]
layout x:    0, 44.13, 79.434          (exactly contiguous)
canvas vs DOM width: agree to within 0.01pt
```

**Fix:** `pixelsToPoints()` / `POINTS_PER_PIXEL` in `src/shared/print/fonts.js`,
applied to both `measure.width` and `measure.lineHeight`. The point-valued
fallbacks are deliberately left unconverted.

Guarded by `test/print-layout.test.js`, whose key invariant is that emphasis
changes the face but never the advance: a styled line must end exactly where
the same text unstyled ends.

### Debugging note

The pure modules take an injected `measure`, so `layout()` can be called
straight from node with a synthetic monospace measure — that is how the layout
was cleared. To inspect the *real* drawing, load `dist/print.html` in a plain
Electron window, call `window.renderJob(job)` (the job shape is in
`printer.js`; settings come from `snapshot(preset)`), then read
`document.querySelectorAll('.run')` for each run's `style.left` against its
`getBoundingClientRect()`. Comparing those two numbers is what exposed the
unit mismatch.

### Not bugs — the dialect is deliberately small

`src/shared/markdown/inline.js` says it is "deliberately a small dialect rather
than a markdown implementation", whose rule is that anything it does not
recognise "is printed literally, character for character". `blocks.js`
recognises only `heading`, `paragraph` and `table`.

So these are **intended behaviour**, not defects:

- `[link](https://example.com)` printing literally — links are not in the dialect.
- A literal `>` on a blockquote line — there is no quote block kind.

Don't "fix" either one into half a markdown implementation. Tests pin both.

## Testing

`npm test` (vitest 3). See `discoveries/test-setup.md` for why vitest 3 rather
than 5, and the esbuild peer-dependency constraint behind it.

## App state

`~/Library/Application Support/LoText/lotext.json` holds prefs, presets,
recent folders and sessions. Delete the directory to test a first launch.
Note that running the harness writes a `recentFolders` entry.

## Printed margins about half an inch too wide from ⌘P, exact from `--pdf`

*2026-09-27.* `lotext --pdf` put the text exactly 72pt in, but paper from ⌘P had margins
0.3–0.5in wider than the preset's, and the text was slightly smaller.

**Cause:** behind the macOS print panel, `webContents.print()`'s `margins: { marginType: 'none' }`
is not what Chromium lays the page out with: it applies its default margins (1cm, or the
printer's unprintable edge if wider) and **shrinks** each 612pt-wide page to fit inside them. So
the preset's margin is scaled and then has the default margin added on top. Reproduced without a
printer by calling `printToPDF({ pageSize: 'Letter' })` with no `margins` on the drawn
`print.html`: text at 93pt instead of 72pt.

**Fix:** `@page { size: <paper>pt; margin: 0 }` in the print window (`print.html`, and the
size set per job in `print-window.js`). Chromium honours CSS page margins whatever margin mode
the panel is in. Check a change here with that no-margins `printToPDF` call, not only with
`--pdf`, which passes zero margins explicitly and so never showed the bug.
