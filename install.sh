#!/usr/bin/env bash
# pocket-t installer — single entry point for the v2 install.
#
# Usage (run from inside a clone of the repo):
#
#     git clone https://github.com/Josh-Gi3r/pocket-t
#     cd pocket-t
#     bash install.sh
#
# What it does:
#   1. Checks prerequisites (Rust toolchain, Node 22+, pnpm).
#   2. Installs Node deps and builds the workspace.
#   3. Builds + ad-hoc codesigns the native `pt` shell proxy, installs
#      it to /usr/local/bin/pt (will prompt for sudo).
#   4. Prints next-step instructions for Terminal.app + starting the
#      daemon.
#
# Phase 1: everything is local + self-hosted. No hosted relay required.
# To control your terminals from another network, spin up the optional
# relay hub yourself (see docs/self-hosting.md) — also from this repo.

set -euo pipefail

REPO_ROOT="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" && pwd )"
cd "$REPO_ROOT"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*" >&2; }

bold "pocket-t installer"
echo

# ─── 1. Prerequisites ─────────────────────────────────────────────────────

missing=()
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    missing+=("$1")
  fi
}
need cargo
need node
need pnpm

if [ ${#missing[@]} -ne 0 ]; then
  red "Missing prerequisites: ${missing[*]}"
  echo
  echo "Install them first:"
  for m in "${missing[@]}"; do
    case "$m" in
      cargo)
        echo "  • Rust:   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
        ;;
      node)
        echo "  • Node:   https://nodejs.org/  (or: brew install node)"
        ;;
      pnpm)
        echo "  • pnpm:   npm install -g pnpm"
        ;;
    esac
  done
  echo
  echo "Then re-run: bash install.sh"
  exit 1
fi

# Node version sanity (need 22+).
node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 22 ]; then
  red "Node $node_major is too old — pocket-t needs Node 22+."
  echo "Upgrade Node and re-run."
  exit 1
fi

green "✓ prerequisites: cargo, node $(node -v), pnpm $(pnpm -v)"

# ─── 2. Workspace install + build ─────────────────────────────────────────

bold "→ installing workspace dependencies…"
pnpm install --frozen-lockfile

bold "→ building daemon + shared + relay + web…"
pnpm -r build

green "✓ workspace built"

# ─── 3. Native pt shell proxy ─────────────────────────────────────────────

bold "→ building, codesigning, and installing the pt shell proxy…"
echo "  (you'll be prompted for sudo to copy the binary into /usr/local/bin)"
bash "$REPO_ROOT/packages/pt-shim/scripts/install.sh"

if ! command -v pt >/dev/null 2>&1; then
  red "Install finished but 'pt' isn't on your PATH. Check /usr/local/bin is in \$PATH."
  exit 1
fi

green "✓ pt installed: $(which pt)"

# ─── 4. cloudflared (for the phone-from-anywhere default) ────────────────

# Phase 1 ships with Cloudflare Quick Tunnel as the default cross-network
# transport. It's free forever, no signup, no card — `cloudflared` opens
# an outbound HTTPS connection to Cloudflare's edge and gets back a
# public URL that proxies to the local pocket-t daemon. The user opens
# that URL on their phone and the demo works.
#
# Best-effort install: if cloudflared isn't already installed and we
# can install it via the system package manager, do so. Otherwise just
# point the user at the install docs and continue — `pt-registry serve`
# (no --tunnel) still works for local-Mac browser use.
if ! command -v cloudflared >/dev/null 2>&1; then
  bold "→ installing cloudflared (Cloudflare Tunnel client)…"
  if command -v brew >/dev/null 2>&1; then
    brew install cloudflared 2>&1 | tail -5 || \
      yellow "  cloudflared install failed — you can install it later for phone access"
  elif command -v apt-get >/dev/null 2>&1; then
    yellow "  Linux detected — install cloudflared manually:"
    echo  "    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  else
    yellow "  Skipping cloudflared install — no supported package manager found."
    echo  "  For phone-from-anywhere access, install cloudflared manually:"
    echo  "    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  fi
fi
if command -v cloudflared >/dev/null 2>&1; then
  green "✓ cloudflared installed: $(which cloudflared)"
fi

# ─── 5. Next steps ────────────────────────────────────────────────────────

echo
bold "Done. Two manual steps remain:"
echo
yellow "1) Set Terminal.app's shell to pt (one-time, takes 5s):"
echo "   • Open Terminal.app → Settings → Profiles"
echo "   • Pick your default profile (or duplicate one)"
echo "   • Shell tab → 'Run command' → /usr/local/bin/pt"
echo "   • Tick 'Run inside shell'"
echo "   • Open a new window — that window is now a pocket-t session"
echo
yellow "2) Start the daemon — pick how you want to reach the UI:"
echo
echo "   ► For your phone (any network, default):"
echo "       pnpm --filter @pocket-t/daemon pt-registry serve --tunnel"
echo "     A free Cloudflare URL + QR code will appear. Open it on your phone."
echo
echo "   ► Local browser only (just this Mac):"
echo "       pnpm --filter @pocket-t/daemon pt-registry serve"
echo "     Then open http://127.0.0.1:7700/ on this Mac."
echo
echo "   ► Self-hosted relay (you operate the public URL):"
echo "       pnpm --filter @pocket-t/daemon pt-registry serve --relay wss://your-hub"
echo "     See docs/self-hosting.md."
echo
echo "Skins: try ?theme=halloween / nokia / cyberpunk / forest / paper /"
echo "       christmas on the URL, or pick from the toolbar dropdown."
echo "       Ship your own: docs/skins.md."
