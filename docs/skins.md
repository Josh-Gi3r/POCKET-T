# pocket-t skins — contribution guide

A pocket-t **skin** is a CSS-variable override block. Nothing more. No
build step, no JS, no per-skin asset bundle. Drop in a small block of
CSS and the entire UI — sidebar, bubbles, terminal pane, cost pill,
approval cards — re-themes itself.

This is the same model the daemon's built-in skins use. The default
"midnight" theme is just the `:root` block; every other skin overrides
the same set of tokens in a `body[data-theme="<name>"]` block.

## The theme token contract

These are the only knobs a skin needs to set. The renderer (xterm.js,
bubbles, sidebar, toolbar) is wired against these tokens.

| Token              | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| `--pt-bg`          | Main app background                              |
| `--pt-fg`          | Default text colour                              |
| `--pt-muted`       | Secondary text (timestamps, labels)              |
| `--pt-dim`         | Tertiary text (placeholders, "empty" states)     |
| `--pt-border`      | All border / divider strokes                     |
| `--pt-sidebar-bg`  | Sidebar + assistant bubble background            |
| `--pt-card-bg`     | Per-session card background (usually transparent)|
| `--pt-card-hover`  | Session card hover + toolbar pill background     |
| `--pt-accent`      | Primary action / active session colour           |
| `--pt-accent-fg`   | Text colour on top of `--pt-accent`              |
| `--pt-cursor`      | Terminal cursor colour                           |
| `--pt-terminal-bg` | xterm.js background                              |
| `--pt-terminal-fg` | xterm.js foreground                              |
| `--pt-font-ui`     | UI font stack (sidebar, toolbar, bubbles)        |
| `--pt-font-mono`   | Monospace font (terminal, tool output)           |

That's it. If you set those values, your skin works.

## Authoring a skin

1. Open `packages/daemon/src/pt-registry/main.ts`.
2. Find the `:root` block at the top of the embedded `<style>`. The
   built-in skins live just below it.
3. Add a new `body[data-theme="<your-skin-name>"]` block. Set whatever
   subset of the tokens you want; anything you skip falls through to
   the midnight default.
4. Add an `<option value="<your-skin-name>">…</option>` to the
   theme-picker `<select>` further down in the HTML.
5. Mirror those changes in `packages/relay/src/wsv3-hub.ts` so remote
   browsers see the same skin via the hosted hub.
6. Reload the page (or click the picker). The whole UI repaints.

A minimal skin is ~12 lines. The included `christmas`, `cyberpunk`,
`forest`, and `paper` skins are good examples.

## How users pick a skin

- Theme picker in the toolbar (dropdown).
- `?theme=halloween` URL parameter for sharing skins.
- The last-picked value is stored in `localStorage["pt-theme"]` so a
  refresh keeps your skin.

## Skin competition / community contributions

We want a public skin gallery. Until that lands:

1. Fork the repo, add your skin to both `pt-registry/main.ts` and
   `wsv3-hub.ts` as above.
2. Open a PR titled `skin: <name>`. Include a screenshot in the PR
   body showing the dashboard + an open Claude session.
3. Bonus points for:
   - A custom `--pt-font-ui` / `--pt-font-mono` stack.
   - A short tagline (one sentence) for the picker dropdown.
   - A 32×32 PNG favicon if your skin needs a different one.

## Future plans

- JSON-driven skin manifest (`packages/web-skins/skins.json`) so skins
  ship without recompiling the daemon.
- `pt-registry skin install <url>` to load a community skin from a
  gist or raw URL into the local CSS.
- A web gallery with live previews.

For now, every PR that adds a skin block is one tiny diff. Open one.
