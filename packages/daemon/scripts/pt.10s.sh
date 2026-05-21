#!/usr/bin/env bash
# pocket-t menu bar widget — drop-in for xbar (https://xbarapp.com) or
# SwiftBar (https://swiftbar.app). The filename suffix `.10s.sh` tells
# both apps to re-run this script every 10 seconds.
#
# Install (xbar):
#   1. Open xbar.
#   2. xbar → Plugins folder → drag this file in. xbar picks it up
#      automatically.
#
# Install (SwiftBar):
#   1. Open SwiftBar, set the plugins directory.
#   2. Copy this file into that directory.
#
# What it shows:
#   - traffic-light icon for daemon health
#   - count of active pt sessions
#   - count of pending Claude approvals (badged red when > 0)
#   - submenu items for: open browser, list sessions, list recordings,
#     toggle relay state
#
# The script only talks to the daemon over its ctl socket — no network,
# no extra binaries, no permissions prompts.

set -euo pipefail

# Resolve the pt-registry binary. Search order:
#   1. $POCKET_T_REGISTRY env var (set this in xbar/SwiftBar to point
#      at a non-default install — e.g. dev tree on a different volume).
#   2. `pt-registry` in PATH.
#   3. ~/pocket-t/packages/daemon/dist/pt-registry/main.js (default repo
#      layout once the daemon is built).
if [ -n "${POCKET_T_REGISTRY:-}" ]; then
  PT_REGISTRY="$POCKET_T_REGISTRY"
elif command -v pt-registry >/dev/null 2>&1; then
  PT_REGISTRY="pt-registry"
elif [ -f "$HOME/pocket-t/packages/daemon/dist/pt-registry/main.js" ]; then
  PT_REGISTRY="/usr/bin/env node $HOME/pocket-t/packages/daemon/dist/pt-registry/main.js"
else
  echo "● pt"
  echo "---"
  echo "pt-registry binary not found"
  echo "set POCKET_T_REGISTRY in xbar to your install path"
  echo "open https://pocket-t.ai | href=https://pocket-t.ai"
  exit 0
fi

# Status JSON — if we can't reach the daemon, render a dim chip.
if ! status=$($PT_REGISTRY status --json 2>/dev/null); then
  echo "○ pt"
  echo "---"
  echo "daemon not running"
  echo "start daemon | bash='pnpm --filter @pocket-t/daemon pt-registry serve' terminal=true"
  exit 0
fi

# Tiny JSON field extractor — avoid a hard `jq` dep. Works because the
# daemon prints `key: number` per line.
field() {
  echo "$status" | tr ',{}' '\n' | grep -E "^\\s*\"$1\":" | head -1 | sed -E 's/.*:[[:space:]]*"?([^",]*)"?.*/\1/' | tr -d '[:space:]'
}

sessions=$(field sessions)
detached=$(field detached)
clients=$(field browserClients)
pending=$(field pendingApprovals)
relay=$(field relayLinks)

sessions=${sessions:-0}
detached=${detached:-0}
clients=${clients:-0}
pending=${pending:-0}
relay=${relay:-0}

# Icon: orange dot if approvals pending, green if active sessions,
# white if idle. xbar interprets ANSI/emoji literally in the menu bar.
if [ "$pending" -gt 0 ]; then
  icon="🟠"
  label="$pending"
elif [ "$sessions" -gt 0 ]; then
  icon="🟢"
  label="$sessions"
else
  icon="⚪"
  label=""
fi

# Top-of-menu chip — visible in the menu bar itself.
echo "${icon} pt ${label}"
echo "---"
echo "pocket-t · ${sessions} sessions (${detached} detached) | font=Menlo size=11"
echo "${clients} browser client(s)$( [ "$relay" -gt 0 ] && echo ' · relay ON' || echo ' · relay OFF') | font=Menlo size=11"
echo "---"
echo "Open local browser | href=http://127.0.0.1:7700/"

# Pending-approvals submenu — one entry per outstanding approval.
if [ "$pending" -gt 0 ]; then
  echo "---"
  echo "⚠️  ${pending} approval$( [ "$pending" -gt 1 ] && echo 's') waiting"
  $PT_REGISTRY pending --json 2>/dev/null | grep -E '"(approvalId|toolName)"' | paste - - | while read -r line; do
    aid=$(echo "$line" | sed -E 's/.*"approvalId":[[:space:]]*"([^"]+)".*/\1/')
    tool=$(echo "$line" | sed -E 's/.*"toolName":[[:space:]]*"([^"]+)".*/\1/')
    echo "  approve ${tool} | bash='${PT_REGISTRY}' param1=approve param2=${aid} param3=approve terminal=false refresh=true"
    echo "  deny    ${tool} | bash='${PT_REGISTRY}' param1=approve param2=${aid} param3=deny    terminal=false refresh=true"
  done
fi

# Recent recordings — last 5.
echo "---"
echo "Recordings"
$PT_REGISTRY recordings --json 2>/dev/null | grep '"sessionId"' | head -5 | while read -r line; do
  sid=$(echo "$line" | sed -E 's/.*"sessionId":[[:space:]]*"([^"]+)".*/\1/')
  echo "  ${sid} | bash='${PT_REGISTRY}' param1=replay param2=${sid} terminal=true"
done

# Footer.
echo "---"
echo "Refresh | refresh=true"
echo "Quit pt-registry | bash='/usr/bin/pkill' param1=-f param2='pt-registry serve' terminal=false refresh=true"
