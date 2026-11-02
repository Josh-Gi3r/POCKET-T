# Pocket-T Terminal-First — Real Mac / iPhone Acceptance

**Status:** Developer branch `feat/terminal-first-join-mobile`. These steps are a **manual smoke test**, not evidence that macOS/iPhone integration has already been verified. Do not merge or deploy until the tests pass on a real Mac and an iPhone.

## Product contract

Pocket-T works as a direct remote terminal **without any AI service or token balance**. Phone and Mac interact with the same live PTY / tmux session, not by clicking a remote Terminal.app window or translating commands into an AI conversation.

- Opening Pocket-T selects a real terminal by default.
- `+ New terminal` creates a **headless Rust `pt` native PTY** on the Mac. No extra Terminal.app window or `osascript` permission prompt is needed for this path.
- Managed shells persist in Pocket-T's private `tmux -L pocket-t` server when tmux is installed.
- `↻ Scan` discovers pre-existing default-tmux panes as well as Terminal.app / iTerm2 tabs. **Only existing tmux sessions can currently be joined** as full interactive terminal clients. Ordinary Terminal.app and iTerm2 windows are inventory-only unless they were already started under `pt`.
- `Join` creates another real tmux client on the same existing shell. The UI must not mark it ready until the Rust shim registers through the Unix socket.
- No remote input is queued while disconnected; an unsent editable draft is retained, not replayed.
- Multiline clipboard text is staged for human review before execution. Direct terminal keystrokes and short pasted lines go to the selected PTY.

## 1. Build/install on the **owner's permitted Mac**

```sh
git fetch origin feat/terminal-first-join-mobile
git switch feat/terminal-first-join-mobile
pnpm install --frozen-lockfile
pnpm --filter @pocket-t/shared build
pnpm -r typecheck
pnpm --filter @pocket-t/daemon test
pnpm -r build
cargo build --manifest-path packages/pt-shim/Cargo.toml --locked
bash install.sh
```

The installer may prompt for a Mac administrator password to copy `pt` into `/usr/local/bin`. **Do not configure Terminal.app to replace all its shells merely to run this test.** The new phone-created shells use `pt` headlessly. Existing Mac windows can remain untouched.

For real persistence on the Mac, install tmux if not already installed:

```sh
brew install tmux
```

Start the daemon in a normal shell that is not running under `pt`:

```sh
pocket
```

The daemon prints a token-gated Cloudflare Quick Tunnel URL. Treat it as a password; never share a URL containing `?t=` or `?token=`.

## 2. Test real new shells

1. Open the printed HTTPS URL in iPhone Safari (test on Wi-Fi and mobile data).
2. Pocket-T should open directly to the **Terminals** workspace, not a chat dashboard.
3. Tap **New terminal**. The daemon starts `pt` headlessly; a session appears and is automatically selected only after registration.
4. Type `pwd` in Compose and send. The actual shell working directory is shown.
5. Type `echo pocket-t-joined` and verify the precise output in the live terminal.
6. Enter **Direct keys** and test interactive programs such as `vim`, `htop` or an interactive CLI. Use Esc, Tab, arrows, Ctrl-C and Enter.
7. Switch sessions and back. Snapshot/scrollback must restore; no duplicate commands should run.
8. Increase and decrease font size. Terminal should fit without a 1-column broken PTY.

## 3. Test **pre-existing** default tmux session joining

Before scanning, start a tmux session separately on the Mac:

```sh
tmux new-session -d -s pocket-existing-test
tmux send-keys -t pocket-existing-test 'echo PRE-EXISTING-SESSION' Enter
tmux list-sessions
```

On the iPhone, open the terminal picker and tap **Scan**. Under **Already open**, find the existing tmux session and tap **Join**.

Expected: Pocket-T registers a `join-<uuid>` session and displays a real tmux terminal. It must not run a new default shell as a fake replacement. Run `echo FROM-IPHONE`, and on the Mac attach separately using `tmux attach -t pocket-existing-test`. Both clients must observe the same shell state.

A tmux session may have multiple panes; the join attaches to the session's current active window/pane (it does **not** claim to target a specific pane). Joining a session with multiple clients can resize its shared PTY when clients have different terminal dimensions. Test this deliberately.

Terminate only the test session afterward:

```sh
tmux kill-session -t pocket-existing-test
```

## 4. Test non-joinable existing windows

Open Terminal.app and iTerm2 tabs **before** scanning, without the `pt` proxy. Scan from the iPhone.

Expected: where macOS Automation permission is granted, these tabs may appear as **Listed**, not **Join**. Denying permission must not break the already-managed terminals. No existing Mac terminal should be killed, restarted or modified during scanning.

## 5. Test mobile failure cases

- Lock/unlock the iPhone, background Safari, return. Same session should reconnect and re-snapshot.
- Disable networking on the phone, enter an editable command, reconnect. Verify the command **does not execute automatically**.
- Paste several shell lines in the xterm area. Verify they move to Compose and require a separate human confirmation before being sent.
- Change iOS keyboard visibility, rotate phone, zoom the terminal font, and use iPhone text selection/copy. Input bar and visible prompt must remain reachable.
- Test two browsers attached to the same managed session. Concurrent typing is allowed today; there is **not yet a server-side exclusive-input lease**. The app must not claim exclusivity.
- Stop the Mac daemon and restart it while a tmux-backed shell runs. The process should remain alive, and a reconnecting client should restore state.

## 6. Explicitly out of scope for this slice

- Full read/write attachment to arbitrary pre-existing Terminal.app, iTerm2, Ghostty, or VS Code integrated terminal PTYs.
- Cloudflare identity pairing, native macOS ScreenCaptureKit, GUI control, Chrome tab adoption, Keychain-backed credential use, Telegram bot, SSH/Tailscale.
- Production deployment and remote access on managed corporate devices without authorisation.

## Development feedback to record

For each test capture: Mac architecture + macOS version; iPhone model + iOS/Safari version; whether tmux is installed; network path; pass/fail; screenshots of the actual iPhone screen; errors and follow-up action. Only promote the branch after the direct PTY and existing-tmux joins pass on real hardware.
