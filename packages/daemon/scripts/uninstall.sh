#!/usr/bin/env bash
# pocket-t uninstaller — fully reverts what install.sh did.
#
#   curl -fsSL https://install.pocket-t.ai/uninstall | sh
#   # or, from a checkout:  bash packages/daemon/scripts/uninstall.sh
#
# Safe to run repeatedly. Never aborts on already-removed pieces.
set -u

BIN="/usr/local/bin/pocket-t"
CONF_DIR="$HOME/.pocket-t"
ZSHRC="$HOME/.zshrc"
BASHRC="$HOME/.bashrc"
PLIST_LABEL="app.pocket-t.daemon"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

echo ""
echo "  Uninstalling pocket-t ..."

# ── Stop + remove the LaunchAgent ────────────────────────────────────────
launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
rm -f "$PLIST_PATH" 2>/dev/null || true
echo "  → LaunchAgent removed"

# ── Kill the isolated tmux server (does NOT touch the user's own tmux) ───
if command -v tmux >/dev/null 2>&1; then
  tmux -L pocket-t kill-server 2>/dev/null || true
  echo "  → pocket-t tmux server stopped"
fi

# ── Strip the auto-attach snippet from the shell rc files ────────────────
strip_snippet() {
  RC="$1"
  [ -f "$RC" ] || return 0
  grep -q "pocket-t: auto-attach" "$RC" 2>/dev/null || return 0
  # Drop everything from the start marker through the end marker,
  # inclusive (markers are written verbatim by install.sh).
  awk '
    /# ─── pocket-t: auto-attach/ { skip = 1 }
    skip == 0 { print }
    /# ─── End pocket-t/         { skip = 0 }
  ' "$RC" > "$RC.pocket-t.tmp" && mv "$RC.pocket-t.tmp" "$RC"
  echo "  → snippet removed from $RC"
}
strip_snippet "$ZSHRC"
strip_snippet "$BASHRC"

# ── Remove daemon config/state ───────────────────────────────────────────
rm -rf "$CONF_DIR" 2>/dev/null || true
echo "  → $CONF_DIR removed"

# ── Remove the binary (needs sudo; best-effort) ──────────────────────────
if [ -e "$BIN" ]; then
  if sudo -n true 2>/dev/null; then
    sudo rm -f "$BIN" && echo "  → $BIN removed"
  else
    echo "  → To remove the binary:  sudo rm -f $BIN"
  fi
fi

echo ""
echo "  ✓ pocket-t uninstalled. Open a new terminal for a clean shell."
echo ""
