# Test setup

*2026-09-22*

`npm test` (vitest run) · `npm run test:watch` (vitest watch)
Tests live in `test/`.

## Why vitest 3, not 5

`npm install -D vitest` fails with `ERESOLVE`:

```
peerOptional esbuild@"^0.27.0 || ^0.28.0" from vite@8.3.0
Found: esbuild@0.24.2  (dev esbuild@"^0.24.0" from the root project)
```

vitest 5 pulls vite 8, which declares esbuild as a **peer** and so collides
with the build's pinned `esbuild@^0.24.0`.

vitest 3 pulls vite 7, which carries esbuild as its **own dependency**. npm
nests it, so the root esbuild is untouched:

```
vitest 3.2.7  ·  vite 7.3.6  ·  vite's own esbuild 0.28.2
root esbuild  0.24.2  (unchanged — build output verified identical after install)
```

Upgrading the root esbuild to 0.27+ would allow vitest 5, but that means
changing the tool that builds the whole app just to add tests. Not worth it
unless esbuild is being upgraded anyway.

## No `"type": "module"` needed

`package.json` has no `"type"` field, so Node treats `.js` as CommonJS while
`src/` is written as ESM. Plain `node` imports work only via module-syntax
detection and print `MODULE_TYPELESS_PACKAGE_JSON` on every file.

**Vitest does not care** — it transforms through vite, so it imports the ESM
sources cleanly with no warning and no config. No module-type change required.

Recorded in case anyone hits it from a different direction:

- Adding `"type": "module"` at the **root would break the app**: `build.mjs`
  emits `format: 'cjs'` into `dist/*.js`, which Electron would then load as ESM.
- A one-line `src/package.json` containing `{"type":"module"}` is the safe
  targeted fix if plain `node` ever needs to import the sources. Verified in a
  scratch copy: it silences the warning, leaves `dist/` as CommonJS, and
  changes only `dist/main.js` — esbuild switches to
  `__toESM(require("node:path"), 1)`, correct Node ESM interop. `--list-presets`,
  `--pdf` and the GUI harness all still pass with it. Not applied, since vitest
  makes it unnecessary.

## What is covered

`test/markdown-inline.test.js` — 12 tests over `src/shared/markdown/inline.js`:
the styles the dialect knows, the "anything unrecognised prints literally"
contract, and a regression guard proving the PDF bold-gap defect does **not**
originate in `parseInline`.

Since then: `argv-files`, `print-layout`, `fuzzy`, `text-ranges` and `emphasis-markers`
have tests too — every pure module worth testing is covered.
