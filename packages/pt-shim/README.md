# pt-shim

The `pt` binary — pocket-t's transparent shell proxy.

`pt` is the shell. When you open Terminal.app / iTerm / Ghostty with `pt`
configured as the launch command, the shell that opens IS `pt`. `pt` then
`forkpty()`s your real shell (`$SHELL`, fallback `/bin/zsh`) as a child
with its own PTY, owns the master fd, and copies bytes faithfully in both
directions between the terminal and the master.

It is a **transparent byte-forwarding proxy** — no scrollback layer, no
key prefix, no mouse interception, no `$TERM` munging. To zsh, `pt` looks
like a normal PTY. To Terminal.app, `pt` looks like a normal child process
writing bytes. Copy/paste, scroll, selection, vim, htop, ANSI colors,
resize — all work natively.

This is fundamentally different from the v1 tmux-hijack model that
breaks copy/paste and scroll, because that model wrapped the shell
inside tmux (a multiplexer that owns the screen). `pt` is a byte pipe.

## Build

```bash
cd packages/pt-shim
cargo build --release
# binary lands at: target/release/pt
```

## Install (local testing)

```bash
sudo cp target/release/pt /usr/local/bin/pt
```

Then in Terminal.app: **Settings → Profiles → Shell → "Shells open with:
Command" → /usr/local/bin/pt**.

Or globally via `chsh`:

```bash
echo /usr/local/bin/pt | sudo tee -a /etc/shells
chsh -s /usr/local/bin/pt
```

## Acceptance — pt does not break a terminal

Open a window through the `pt` profile. You should see a normal zsh
prompt and *everything that worked before still works*:

- [ ] `.zshrc` loads (aliases / prompt / completions).
- [ ] Copy/paste (`Cmd+C` / `Cmd+V`) works.
- [ ] Scrollback (`Cmd+↑` or two-finger scroll) works.
- [ ] Selection (mouse drag highlights, right-click copy) works.
- [ ] `vim` opens normally, mouse mode works, editing is fluid.
- [ ] `less /etc/services` scrolls without breaking.
- [ ] `htop` renders normally and updates.
- [ ] Resizing the window resizes the shell (`stty size` reflects the
      new rows/cols inside the shell — SIGWINCH propagates).
- [ ] `Ctrl+C` interrupts, `Ctrl+D` exits, `Ctrl+Z` suspends.
- [ ] `exit` closes the shell and the window closes cleanly.

If any of those fail, that's a bug — open an issue.

## What pt forwards to the daemon

When the pocket-t daemon is running, pt also opens an outbound Unix
socket to it and:

- Tees the PTY's output to the daemon (so browsers can mirror it).
- Accepts INPUT frames (browser keystrokes → write into PTY master).
- Accepts RESIZE_REMOTE frames (browser drives PTY size for vim/htop).
- Accepts KILL frames (signal to the shell's process group).
- Reports REGISTER (session id, cwd, pid, geometry) and EXIT (status).

If the daemon isn't running, none of that happens — pt still works as
a plain shell proxy. The local terminal experience is identical with
or without the daemon connected.

## Implementation

A single `src/main.rs` (~500 LOC) plus a small `src/ipc.rs` using `libc`
directly. No `nix`, no `tokio` — POSIX syscalls only. Pattern follows
the standard `script(1)` recorder and VibeTunnel's Zig `vt-fwd`:
forkpty, own the master, `poll()` between stdin and master, copy bytes,
handle SIGWINCH, restore termios on exit.
