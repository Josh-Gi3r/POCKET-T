# Pocket-T Logo Kit

Master files for every place the Pocket-T brand needs to appear.

## What's inside

### `signet/` — the pocket-shaped icon (no wordmark)
Use for: app icons, favicons, OG images, single-glyph marks.
- `signet-light-transparent.svg` + PNGs (256/512/1024) — mint outline + white `>_`, transparent bg → for **dark backgrounds**
- `signet-dark-transparent.svg` — mint outline + graphite `>_`, transparent bg → for **light backgrounds**
- `signet-on-dark.svg` + PNGs — locked onto Deep Graphite `#0B0F12`
- `signet-on-white.svg` + PNGs — locked onto white

### `wordmark/` — "Pocket-T" text only (no signet)
Use for: places where the brand mark is already implied or there's no room for the signet.
- `wordmark-light-transparent.svg` — white Pocket + mint `-T` → for dark backgrounds
- `wordmark-dark-transparent.svg` — graphite Pocket + mint `-T` → for light backgrounds

> The PNG versions of the wordmark/lockup files were intentionally **not** generated automatically — they depend on having Space Grotesk installed. Open the SVG in Figma, Illustrator, or any browser with the font, and export at the size you need. (Or open `Pocket-T Brand Guidelines.html` in a browser and screenshot.)

### `lockup/` — signet + wordmark together
Use for: nav bars, hero sections, business cards, signatures.
- `lockup-horizontal-*` — single row: signet then wordmark.
- `lockup-stacked-*` — signet on top, wordmark below. For square crops.
- Each comes in 4 variants: light-transparent, dark-transparent, on-dark (locked bg), on-white (locked bg).

### `app-icon/` — squircle app icon
Already locked into the dark-gradient squircle shell. Drop straight into Xcode / Android Studio / your PWA manifest.
- `app-icon.svg` — master 1024×1024
- `app-icon-1024.png`, `app-icon-512.png`, `app-icon-256.png`

## Colors used

- **Electric Mint** `#00F0B5` — primary on dark backgrounds
- **Electric Mint 2** `#00C99A` — primary on light backgrounds (slightly darker for AA contrast)
- **Off-White** `#F5F7FA` — glyph on dark
- **Deep Graphite** `#0B0F12` — glyph on light, canvas

## Font

Wordmark is **Space Grotesk SemiBold (600)**, tracking −0.025em. Get it from Google Fonts.

## Don't

- Don't recolor outside the palette.
- Don't stretch or distort the mark.
- Don't add shadows, glows, or gradients to the wordmark.
- Don't all-caps the wordmark — it's `Pocket-T`, never `POCKET-T`.
- Don't put the signet inside a rounded-square chrome unless it's an app icon.

See `Pocket-T Brand Guidelines.html` for the full rule set.
