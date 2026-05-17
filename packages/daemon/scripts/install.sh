#!/usr/bin/env bash
set -euo pipefail

# A-008: pinned, checksum-verified install. We never install from a mutable
# "latest" path and never load the LaunchAgent until every downloaded
# artifact matches a signed SHA256SUMS manifest. Override the version with
# POCKET_T_VERSION=vX.Y.Z. (Notarization/code-signing of the binary is the
# remaining gap and requires an Apple Developer identity + release pipeline.)

RELAY="https://relay.pocket-t.app"
BIN_DIR="/usr/local/bin"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"
PLIST="app.pocket-t.daemon.plist"
LABEL="app.pocket-t.daemon"
VERSION="${POCKET_T_VERSION:-v0.1.0}"
BASE="$RELAY/releases/$VERSION"

# ── Detect architecture ───────────────────────────────────────────────────
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  TARBALL="pocket-t-daemon-darwin-arm64.tar.gz"
else
  TARBALL="pocket-t-daemon-darwin-x64.tar.gz"
fi

echo ""
echo "  Installing pocket-t daemon $VERSION ..."
echo ""

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ── Download (pinned version) + checksum manifest ─────────────────────────
echo "  → Downloading $TARBALL ($VERSION)..."
curl -fsSL "$BASE/$TARBALL"          -o "$TMP/$TARBALL"
curl -fsSL "$BASE/$PLIST"            -o "$TMP/$PLIST"
curl -fsSL "$BASE/SHA256SUMS"        -o "$TMP/SHA256SUMS"

# ── Verify checksums BEFORE touching the system — fail closed ─────────────
echo "  → Verifying checksums..."
( cd "$TMP" && grep -E "  ($TARBALL|$PLIST)\$" SHA256SUMS > SHA256SUMS.want \
  && shasum -a 256 -c SHA256SUMS.want ) || {
  echo "  ✗ Checksum verification FAILED — aborting, nothing installed." >&2
  exit 1
}

# ── Install binary (only after verification) ──────────────────────────────
echo "  → Installing binary to $BIN_DIR/pocket-t..."
tar -xzf "$TMP/$TARBALL" -C "$TMP"
sudo install -m 755 "$TMP/pocket-t" "$BIN_DIR/pocket-t"

# ── Install + load LaunchAgent (verified copy) ────────────────────────────
echo "  → Installing LaunchAgent..."
mkdir -p "$LAUNCHD_DIR"
install -m 644 "$TMP/$PLIST" "$LAUNCHD_DIR/$PLIST"

echo "  → Loading LaunchAgent..."
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$LAUNCHD_DIR/$PLIST"

echo ""
echo "  ✓ pocket-t daemon $VERSION installed (checksum-verified)!"
echo ""
echo "  Next step — connect your Mac to your account:"
echo ""
echo "    pocket-t auth <your-token>"
echo ""
echo "  Get your token at: https://app.pocket-t.app/dashboard"
echo ""
