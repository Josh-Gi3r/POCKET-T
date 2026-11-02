# Pocket-T web client — terminal-first

The mobile/browser application for Pocket-T. **The live terminal is the product**, not an optional tool behind an AI conversation. Every terminal byte comes from a real Mac PTY, or a second real tmux client that joins a pre-existing tmux session.

The browser does not depend on an AI model, API key, token balance, OpenAI, Claude, or any external AI provider. Agent conversation/activity is a secondary view only for sessions with an available adapter.

## UX

- On iPhone, the terminal occupies the primary viewport. The app has a compact session switcher, a terminal shortcut row (Esc, Tab, Ctrl-C/D/Z, arrows, Home/End, etc.), an editable command composer, **Direct keys** mode, adjustable monospace size, copy/paste and a fullscreen-style view.
- The desktop interface adds a persistent session list and separate Files, Apps and Vault navigation (capability restrictions apply).
- The live xterm widget consumes raw `Uint8Array` VT bytes to preserve split Unicode and escape sequences, and restores the daemon's VT snapshot on mount or resubscribe.
- Browser/daemon reconnects restore visual state; **user input is not queued across disconnections**. Text typed into Compose is kept in a local on-screen draft, not sent later without another explicit send.
- Multiline paste from the terminal area is staged into Compose. Sending a multiline command requires review then confirmation. Pasting directly to a terminal remains a high-impact action; don't use unknown shell text.

## Actual terminal sources

| Source | Capability |
|---|---|
| Phone-created native shell | Full PTY via headless `pt`; private tmux persistence where installed |
| `pt`-owned Terminal.app window | Full PTY via `pt` proxy |
| Existing default `tmux` session | Full live terminal client via `pt` headless child `tmux attach-session -t <verified-session-id>` |
| Existing native Terminal.app/iTerm2 window not using `pt` | Discoverable if macOS Automation allows, **not** directly joined |
| Existing VS Code/Ghostty/WezTerm window | Not yet universally discoverable/joinable; requires additional adapters |

The Mac-side daemon enumerates targets; the browser only sends a session identifier which the daemon revalidates against current tmux inventory. A join is shown as ready only after the native shim registers. A user may already be attached on another device; there is no exclusive-input lease in this first slice.

## Build

```bash
pnpm install --frozen-lockfile
pnpm --filter @pocket-t/shared build
pnpm --filter @pocket-t/web-client typecheck
pnpm --filter @pocket-t/web-client build
```

Vite emits static assets to `packages/web-client/dist/`. The daemon serves those assets with its existing token-gated entry page; if `dist/` is absent it falls back to the old single-file terminal client.

## How to test

See [Terminal-first real-device smoke test](../../docs/terminal-first-smoke-test.md).

Manual testing **must** include iPhone Safari keyboard resizing, terminal reconnect, multiclient tmux resizing, and actual pre-existing tmux session continuity. CI verifies syntax, types and unit tests but is not evidence of a successful end-to-end Mac/iPhone handoff.

## Security

- The legacy browser connection uses the existing Pocket-T token gate. Treat its tokenized URL as a password.
- Remote input has the same privileges as the Mac user's shell. No attempt is made to bypass macOS, VPN, firewall, MDM or application policy.
- Files and Apps are separate permission-checked capability adapters; the Vault page is a design preview, **not** a password storage or auto-fill service.
- The primary UI remains usable without any AI account or tokens.
