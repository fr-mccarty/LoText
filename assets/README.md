# Icon

`icon.svg` is the master: the Lucide **`edit`** glyph (an alias of `square-pen`, ISC licensed,
<https://lucide.dev>) in white on a `#3478f6` squircle — the same blue as `--accent`, measured
from the reference app's default button.

The art sits in an 824px square centred in a 1024px canvas, which is the macOS icon grid: that
padding is what makes the icon the same visual size as every other app's in the Dock.

- `icon-1024.png` — the rasterised master, transparent outside the squircle.
- `icon.icns` — what ships in the app bundle, built from the PNG.

Nothing here rasterises SVG, so the PNG is rendered by loading the SVG in an Electron window
and calling `capturePage()`. To rebuild:

```sh
sips -z 16 16 assets/icon-1024.png --out icon.iconset/icon_16x16.png   # and 32, 128, 256, 512
iconutil -c icns icon.iconset -o assets/icon.icns                      # plus each @2x
```
