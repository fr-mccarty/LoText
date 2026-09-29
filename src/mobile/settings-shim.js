// The Settings panel is the Mac's page (src/renderer/settings/settings.js) in a frame over the
// app. It reads `window.lotext` as it loads, so this lends it the app's bridge first — one whose
// subscriptions are dropped when the sheet closes (src/mobile/ui.js).

window.lotext = window.parent.lotextForFrame()
