// LoText on iPhone and iPad — the web half. See specs/mobile.md.
//
// The Mac's renderer (src/renderer/index.js) is loaded as it is. What changes is underneath and
// around it: `window.lotext` is the iOS bridge instead of the preload script, and
// `window.lotextShell` builds the bars, menus and keyboard bar a phone needs around the Mac's
// views. Both have to be in place before the renderer runs, which is why this file is only
// imports, in this order.

import './install.js'
import '../renderer/index.js'
