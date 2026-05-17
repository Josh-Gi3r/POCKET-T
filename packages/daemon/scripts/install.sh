#!/usr/bin/env bash
# One-line installer: curl -fsSL https://install.pocket-t.app | sh
#
# After install + restart, EVERY terminal you open (Terminal.app, iTerm2,
# Ghostty, anything) auto-attaches to pocket-t's isolated tmux server and
# appears on your phone — no wrappers, no per-window commands.
#
# A-008: pinned version + SHA256SUMS verification, fail-closed. Notarized
# signing of the binary is the one remaining gap (needs an Apple identity).
set -euo pipefail

RELAY="https://relay.pocket-t.app"
BIN_DIR="/usr/local/bin"
CONF_DIR="$HOME/.pocket-t"
ZSHRC="$HOME/.zshrc"
BASHRC="$HOME/.bashrc"
PLIST_LABEL="app.pocket-t.daemon"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
VERSION="${POCKET_T_VERSION:-v0.1.0}"
BASE="$RELAY/releases/$VERSION"

ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  TARBALL="pocket-t-daemon-darwin-arm64.tar.gz"
else
  TARBALL="pocket-t-daemon-darwin-x64.tar.gz"
fi

echo ""
echo "  Installing pocket-t $VERSION ..."
echo ""

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ── Download (pinned) + checksum manifest, verify BEFORE install ──────────
echo "  → Downloading daemon ($VERSION)..."
curl -fsSL "$BASE/$TARBALL"   -o "$TMP/$TARBALL"
curl -fsSL "$BASE/SHA256SUMS" -o "$TMP/SHA256SUMS"
echo "  → Verifying checksum..."
( cd "$TMP" && grep -E "  $TARBALL\$" SHA256SUMS > want.sha && shasum -a 256 -c want.sha ) || {
  echo "  ✗ Checksum verification FAILED — aborting, nothing installed." >&2
  exit 1
}

tar -xzf "$TMP/$TARBALL" -C "$TMP"
sudo install -m 755 "$TMP/pocket-t" "$BIN_DIR/pocket-t"
chmod +x "$BIN_DIR/pocket-t" 2>/dev/null || true

# ── Ensure tmux is installed (the auto-capture mechanism) ────────────────
if ! command -v tmux >/dev/null 2>&1; then
  echo "  → tmux not found. Installing via Homebrew..."
  if command -v brew >/dev/null 2>&1; then
    brew install tmux
  else
    echo "  ✗ Please install tmux: https://github.com/tmux/tmux/wiki/Installing"
    echo "    then re-run this installer."
    exit 1
  fi
fi

# ── pocket-t tmux.conf (isolated server, not the user's own tmux) ────────
mkdir -p "$CONF_DIR"
cat > "$CONF_DIR/tmux.conf" << 'TMUXCONF'
# pocket-t isolated tmux server
set -g default-terminal "tmux-256color"
set -g escape-time 25
set -g focus-events on
set -g history-limit 5000
set -g window-size latest
set -g status off
set -g mouse off
set -g visual-bell off
set -g visual-activity off
setw -g monitor-activity off
set -g bell-action none
TMUXCONF
echo "  → tmux.conf written to $CONF_DIR/tmux.conf"

# ── Auto-attach shell snippet — "every terminal is a pocket-t terminal" ──
SNIPPET=$(cat << 'SHELLSNIPPET'

# ─── pocket-t: auto-attach terminals to tmux ────────────────────────────
# Every interactive terminal you open runs inside the pocket-t tmux server.
# Your shell, cwd, history, env — all intact.
# Opt out for one terminal: POCKET_T_NO_ATTACH=1 zsh
__pocket_t_attach() {
  command -v tmux >/dev/null 2>&1 || return
  [ -z "$TMUX" ]                  || return  # already inside tmux
  [ -z "$STY" ]                   || return  # inside GNU screen
  [ -n "$PS1" ]                   || return  # must be interactive
  case $- in *i*) ;; *) return ;; esac
  [ -z "$POCKET_T_NO_ATTACH" ]    || return  # user opt-out
  [ "$TERM_PROGRAM" = "vscode" ]              && return
  [ "$TERM_PROGRAM" = "cursor" ]              && return
  [ "$TERMINAL_EMULATOR" = "JetBrains-JediTerm" ] && return
  [ -n "$INSIDE_EMACS" ]                      && return
  exec tmux \
    -L pocket-t \
    -f "$HOME/.pocket-t/tmux.conf" \
    new-session -A -s "term-$$"
}
__pocket_t_attach
# ─── End pocket-t ───────────────────────────────────────────────────────
SHELLSNIPPET
)
MARKER="# ─── pocket-t: auto-attach"

install_snippet() {
  local RC="$1"
  if [ -f "$RC" ] && grep -q "$MARKER" "$RC" 2>/dev/null; then
    echo "  → $RC already has the pocket-t snippet, skipping"
    return
  fi
  echo "$SNIPPET" >> "$RC"
  echo "  → pocket-t auto-attach added to $RC"
}
install_snippet "$ZSHRC"
install_snippet "$BASHRC"

# ── LaunchAgent (daemon starts on login) ─────────────────────────────────
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BIN_DIR}/pocket-t</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>/tmp/pocket-t-daemon.log</string>
  <key>StandardErrorPath</key><string>/tmp/pocket-t-daemon.err</string>
  <key>ThrottleInterval</key><integer>10</integer>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"

echo ""
echo "  ✓ pocket-t $VERSION installed (checksum-verified)!"
echo ""
echo "  Next: connect this Mac to your account"
echo ""
echo "    pocket-t auth <your-token>"
echo ""
echo "  Get your token at: https://app.pocket-t.app/dashboard"
echo ""
echo "  ════════════════════════════════════════════════"
echo "  IMPORTANT: open a new terminal (or restart your"
echo "  Mac). Every terminal you open after that appears"
echo "  on your phone automatically."
echo "  ════════════════════════════════════════════════"
echo ""
