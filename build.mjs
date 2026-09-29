// Bundles every entry point. esbuild is the only build step there is.
//
// The Mac app goes to dist/: the main process, the preload bridge, and each window's script are
// separate bundles because each runs in a different world.
//
// `--mobile` builds the iOS app's web half into dist-mobile/ instead: the same renderer, with
// src/mobile/ standing in for the main process and the preload bridge. `npx cap sync ios` copies
// it into the Xcode project. See specs/mobile.md.
//
// `--web` builds the editor for a web page into dist-web/: src/web/playground.js and its CSS, which
// lolekproductions.org/LoText mounts so people can try the editor. Minified and without comments,
// because it is served to strangers and checked in to the site's repository.
import { build, context } from 'esbuild'
import { mkdirSync, cpSync } from 'node:fs'

const watch = process.argv.includes('--watch')
const mobile = process.argv.includes('--mobile')
const web = process.argv.includes('--web')

const common = {
  bundle: true,
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
}

const desktopEntries = [
  { in: 'src/main/main.js', out: 'dist/main.js', platform: 'node', external: ['electron'] },
  { in: 'src/main/preload.js', out: 'dist/preload.js', platform: 'node', external: ['electron'] },
  { in: 'src/renderer/index.js', out: 'dist/renderer.js', platform: 'browser', format: 'iife' },
  { in: 'src/renderer/settings/settings.js', out: 'dist/settings.js', platform: 'browser', format: 'iife' },
  { in: 'src/main/print/print-window.js', out: 'dist/print-window.js', platform: 'browser', format: 'iife' },
]

// The web view is WebKit on iOS 17 or later; nothing else ever loads these.
const mobileBrowser = { platform: 'browser', format: 'iife', target: 'safari17' }
const mobileEntries = [
  { in: 'src/mobile/main.js', out: 'dist-mobile/renderer.js', ...mobileBrowser },
  { in: 'src/mobile/settings-shim.js', out: 'dist-mobile/settings-shim.js', ...mobileBrowser },
  { in: 'src/renderer/settings/settings.js', out: 'dist-mobile/settings.js', ...mobileBrowser },
  { in: 'src/main/print/print-window.js', out: 'dist-mobile/print-window.js', ...mobileBrowser },
]

const webEntries = [
  { in: 'src/web/playground.js', out: 'dist-web/lotext-playground.js', platform: 'browser', format: 'iife', target: 'es2020' },
]

if (web) {
  mkdirSync('dist-web', { recursive: true })
  cpSync('src/web/playground.css', 'dist-web/lotext-playground.css')
} else if (mobile) {
  mkdirSync('dist-mobile', { recursive: true })
  cpSync('src/html/print.html', 'dist-mobile/print.html')
  cpSync('src/html/settings.css', 'dist-mobile/settings.css')
  cpSync('src/renderer/style.css', 'dist-mobile/style.css')
  cpSync('src/mobile/html', 'dist-mobile', { recursive: true })
  cpSync('src/mobile/mobile.css', 'dist-mobile/mobile.css')
} else {
  mkdirSync('dist', { recursive: true })
  cpSync('src/html', 'dist', { recursive: true })
  cpSync('src/renderer/style.css', 'dist/style.css')
}

for (const entry of web ? webEntries : mobile ? mobileEntries : desktopEntries) {
  const options = {
    ...common,
    ...(web ? { minify: true, sourcemap: false, legalComments: 'none' } : {}),
    entryPoints: [entry.in],
    outfile: entry.out,
    platform: entry.platform,
    format: entry.format ?? common.format,
    target: entry.target ?? common.target,
    external: entry.external ?? [],
  }
  if (watch) {
    const ctx = await context(options)
    await ctx.watch()
  } else {
    await build(options)
  }
}
