# Icons (placeholders needed)

Overwolf packaging requires these real assets before an `.opk` can be built.
Add them here (names must match `public/manifest.json`):

- `icon256.png` — 256×256 color app icon
- `icon256_gray.png` — 256×256 grayscale (shown when the game isn't running)
- `icon.ico` — Windows launcher icon

Until then the app still sideloads for development, but store submission will
reject a build without them.
