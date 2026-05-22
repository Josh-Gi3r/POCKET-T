# AGENTS.md

> AI install guide for Pocket-T. If a human asks you to install Pocket-T on
> their Mac, follow this file end-to-end. It is deterministic, terse, and
> assumes you (the agent) have shell access on the same Mac as the human.
>
> Do **not** improvise. Do **not** modify the human's `.zshrc`, `.bashrc`,
> `.config`, or any other dotfile beyond what this file says. If a step
> fails, surface the error to the human and stop — do not paper over it.

## What Pocket-T is

A native Rust shell proxy (`pt`) + a TypeScript daemon (`pt-registry`) that
mirrors every macOS terminal session to any browser, anywhere — over a
free Cloudflare Quick Tunnel by default. The human runs commands locally
as normal; Pocket-T streams the PTY bytes to a web client they open on
their phone or any other browser.

Repo: <https://github.com/Josh-Gi3r/POCKET-T>

---

## 1. Prerequisites

Check each. Install what is missing. Skip anything already present.

```bash
# macOS 14+
sw_vers -productVersion

# Homebrew (used for cloudflared, optionally node)
command -v brew >/dev/null || /bin/bash -c \
  "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Rust (needed to compile pt-shim)
command -v cargo >/dev/null || curl --proto '=https' --tlsv1.2 -sSf \
  https://sh.rustup.rs | sh -s -- -y
# If cargo was just installed, source it for the current shell:
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"

# Node 22+
node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])' || brew install node

# pnpm
command -v pnpm >/dev/null || npm install -g pnpm

# cloudflared (for the default tunnel mode)
command -v cloudflared >/dev/null || brew install cloudflared
```

If any of these prompts for `sudo` (Homebrew, the install script, etc.),
surface the prompt to the human — they need to enter their password.

---

## 2. Install

```bash
cd ~
git clone https://github.com/Josh-Gi3r/POCKET-T
cd POCKET-T
bash install.sh
```

`install.sh` will:

1. `pnpm install` and `pnpm -r build` the workspace.
2. Build `packages/pt-shim` in release mode with `cargo`.
3. Ad-hoc codesign the resulting `pt` binary.
4. Copy it to `/usr/local/bin/pt` (will prompt for `sudo`).

Verify:

```bash
which pt          # → /usr/local/bin/pt
pt --version      # → pt 0.1.x
```

If `which pt` is empty, the install did not finish — re-run `bash install.sh`
and surface the error to the human.

---

## 3. The one manual step — Terminal app shell setting

This is the **only** step you cannot automate. Print the instructions
below to the human verbatim, then **pause** and wait for them to confirm
before continuing.

### If the human uses Terminal.app (default)

> Open Terminal.app → **Settings** (⌘,) → **Profiles** → pick the profile
> you use → **Shell** tab → **Run command:** `/usr/local/bin/pt` → tick
> **Run inside shell** → close Settings → quit and reopen Terminal.app so
> the new shell takes effect.

### If the human uses iTerm2

> Preferences → Profiles → General → Command → **Custom Shell** →
> `/usr/local/bin/pt`. Then quit and reopen iTerm2.

### If the human uses Ghostty

> Edit `~/.config/ghostty/config` and add `command = /usr/local/bin/pt`.
> Quit and reopen Ghostty.

### If the human uses WezTerm

> Edit `~/.config/wezterm/wezterm.lua` and add
> `config.default_prog = { '/usr/local/bin/pt' }`. Quit and reopen WezTerm.

Do **not** edit any of these files yourself — let the human do it so they
see the change happen and learn how to undo it later.

---

## 4. Start the daemon

`install.sh` installs a global `pocket` launcher in `/usr/local/bin/`.
You do **not** need to be in the repo directory to run it — but the
terminal you start it from must **not** be going through `pt` (open a
fresh `/bin/zsh`, or any non-`pt` terminal profile).

```bash
pocket
```

The daemon will print:

- A `https://<subdomain>.trycloudflare.com` URL.
- A QR code in the terminal.

Capture the URL — that is what the human opens on their phone.

**Security note (must tell the human):** Treat the tunnel URL as a password.
Anyone with that URL can access and control the mirrored terminal while the
daemon is running. Do not share it in screenshots, chats, or public posts.


LAN-only mode (no public tunnel, only reachable on the same Wi-Fi):

```bash
pocket serve
```

This prints a `http://<mac-lan-ip>:<port>` URL instead.

Other useful subcommands:

```bash
pocket list           # list active sessions
pocket kill <id>      # kill a session
pocket replay <id>    # replay a recorded session
pocket pending        # list pending tool-call approvals
```

Anything you pass that is not the bare `pocket` command is forwarded
verbatim to the underlying `pt-registry` CLI.

To run the daemon detached at login, the human can use the launchd plist
in `packages/daemon/launchd/` — point them at it but do not install it
without their consent.

---

## 5. Verification

1. The human opens a new Terminal.app (or iTerm/Ghostty/WezTerm) window.
   The prompt should look and feel normal — same `$PS1`, same colours,
   same `.zshrc` aliases. If anything looks different, stop and report.
2. The daemon's log should print `session registered: pt-xxxx`.
3. The human opens the printed URL on their phone (or any browser).
4. The session shows up in the session list with a live preview.
5. `echo hello` in the local terminal should appear in the browser
   within ~50ms.
6. Typing in the browser should appear in the local terminal.
7. Resize the local terminal — the browser should follow.

If any of these fail, see Common failures below.

---

## 6. Common failures

| Symptom | Cause / fix |
| --- | --- |
| `/usr/local/bin/pt: command not found` | Installer never copied. Re-run `bash install.sh`. Confirm `/usr/local/bin` is on `$PATH`. |
| Terminal opens then immediately closes | `pt` could not launch the underlying shell. Run `/usr/local/bin/pt` from a plain zsh to see the stderr. Usually `$SHELL` is set to a non-existent path. |
| `pnpm install` fails on `node-pty` | Xcode CLI tools missing. Run `xcode-select --install`. |
| `cargo build` fails | Rust toolchain too old. `rustup update stable`. |
| Session never shows in browser | Daemon not running, or the browser is on the wrong URL. Re-print the URL with `Ctrl-L` in the daemon's terminal. |
| Cloudflare URL works on Wi-Fi, not LTE | Edge DNS hiccup. Wait 60 seconds or restart the daemon for a fresh URL. |
| `pocket: command not found` | `install.sh` never finished, or `/usr/local/bin` is not on `$PATH`. Re-run `bash install.sh` from the repo root. |

---

## 7. Uninstall

```bash
# Stop the daemon (Ctrl-C in its terminal, or kill the pnpm process).
sudo rm /usr/local/bin/pt
rm -rf ~/POCKET-T
brew uninstall cloudflared   # optional
```

Then restore the Terminal.app / iTerm2 / Ghostty / WezTerm shell setting
to whatever it was before (usually `/bin/zsh`) using the same panel from
step 3.

---

## 8. If the install flow ever changes

The source of truth is `install.sh` at the repo root. If a step here
disagrees with `install.sh`, trust `install.sh` and report the
discrepancy to the human. Do not silently follow stale instructions.

Deeper documentation lives in `docs/`:

- `docs/architecture.md` — how the pieces fit together
- `docs/self-hosting.md` — running your own relay instead of Cloudflare
- `docs/security.md` — threat model + what's encrypted
- `docs/skins.md` — how to ship a new theme
- `docs/contributing.md` — code style + PR process
