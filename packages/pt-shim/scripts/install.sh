#!/usr/bin/env bash
# install.sh — build, ad-hoc codesign, and install `pt` to /usr/local/bin.
#
# Why codesign: recent macOS versions SIGKILL unsigned binaries at exec time
# (silently — Terminal.app just shows "[Process completed]"). Ad-hoc signing
# with the local key is enough to satisfy the kernel and let the binary run.
# This is the same trick VibeTunnel and most Rust-on-macOS distributions use.

set -euo pipefail

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
CRATE_DIR="$( cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd )"
BIN_NAME="pt"
INSTALL_PATH="/usr/local/bin/$BIN_NAME"

echo "[pt-shim] building (release)…"
( cd "$CRATE_DIR" && cargo build --release )

BUILT="$CRATE_DIR/target/release/$BIN_NAME"
if [ ! -x "$BUILT" ]; then
  echo "[pt-shim] build artefact missing: $BUILT" >&2
  exit 1
fi

echo "[pt-shim] ad-hoc codesigning…"
codesign --force --sign - "$BUILT"

echo "[pt-shim] installing to $INSTALL_PATH (will prompt for sudo)…"
sudo cp "$BUILT" "$INSTALL_PATH"
sudo chmod +x "$INSTALL_PATH"

# Re-sign the installed copy too: `sudo cp` from a signed source preserves
# the signature on macOS, but signing in place is cheap insurance.
sudo codesign --force --sign - "$INSTALL_PATH"

echo "[pt-shim] done."
echo "         binary: $INSTALL_PATH"
echo "         verify: which pt && pt --help 2>/dev/null || true"
echo
echo "Set as your Terminal.app shell:"
echo "  Settings → Profiles → (your profile) → Shell"
echo "  → Run command: $INSTALL_PATH"
echo "  → Run inside shell: UNCHECKED"
