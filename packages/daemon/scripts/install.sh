#!/usr/bin/env bash
set -euo pipefail

RELAY="https://relay.pocket-t.app"
BIN_DIR="/usr/local/bin"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"
PLIST="app.pocket-t.daemon.plist"
LABEL="app.pocket-t.daemon"

# ── Detect architecture ───────────────────────────────────────────────────
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  TARBALL="pocket-t-daemon-darwin-arm64.tar.gz"
else
  TARBALL="pocket-t-daemon-darwin-x64.tar.gz"
fi

echo ""
echo "  Installing pocket-t daemon..."
echo ""

# ── Download ──────────────────────────────────────────────────────────────
TMP=$(mktemp -d)
echo "  → Downloading $TARBALL..."
curl -fsSL "$RELAY/releases/latest/$TARBALL" -o "$TMP/daemon.tar.gz"

# ── Install binary ────────────────────────────────────────────────────────
echo "  → Installing binary to $BIN_DIR/pocket-t..."
tar -xzf "$TMP/daemon.tar.gz" -C "$TMP"
sudo install -m 755 "$TMP/pocket-t" "$BIN_DIR/pocket-t"

# ── Install LaunchAgent ───────────────────────────────────────────────────
echo "  → Installing LaunchAgent..."
mkdir -p "$LAUNCHD_DIR"
curl -fsSL "$RELAY/releases/latest/$PLIST" \
  -o "$LAUNCHD_DIR/$PLIST"

# ── Load LaunchAgent ──────────────────────────────────────────────────────
echo "  → Loading LaunchAgent..."
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$LAUNCHD_DIR/$PLIST"

# ── Cleanup ───────────────────────────────────────────────────────────────
rm -rf "$TMP"

echo ""
echo "  ✓ pocket-t daemon installed!"
echo ""
echo "  Next step — connect your Mac to your account:"
echo ""
echo "    pocket-t auth <your-token>"
echo ""
echo "  Get your token at: https://app.pocket-t.app/dashboard"
echo ""
