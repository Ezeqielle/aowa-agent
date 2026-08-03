# Icons

The real AOWA mark — the Tenno shield with the glowing energy "A", rendered from
the web app's `frontend/public/favicon.svg` so the agent and website share one
brand. Regenerate after the SVG changes:

```sh
SVG=../../aowa/frontend/public/favicon.svg   # path to the web favicon
for s in 16 24 32 48 64 128 256; do rsvg-convert -w $s -h $s "$SVG" -o /tmp/icon-$s.png; done
cp /tmp/icon-256.png icon256.png
magick /tmp/icon-256.png -colorspace Gray icon256_gray.png
magick /tmp/icon-16.png /tmp/icon-24.png /tmp/icon-32.png /tmp/icon-48.png /tmp/icon-64.png /tmp/icon-128.png /tmp/icon-256.png icon.ico
```

Keep the names that `public/manifest.json` references:

- `icon256.png` — 256×256 color app icon
- `icon256_gray.png` — 256×256 grayscale (shown when the game isn't running)
- `icon.ico` — Windows launcher icon (multi-size)
