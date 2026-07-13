# Always-on setup — reach your Mac from anywhere, 24/7

The default `pocket serve --tunnel` opens a Cloudflare **Quick Tunnel**: free,
zero-config, but ephemeral (the URL changes every restart) and **unauthenticated
— anyone with the URL reaches your terminal**. This runbook wires the durable
version:

- a **named** Cloudflare tunnel with a stable hostname on your own domain,
- the tunnel running as a **boot LaunchDaemon** (survives logout/reboot),
- **Cloudflare Access** in front so only you can open the UI,
- the pocket-t **daemon** started on login by the fixed launchd plist,
- **caffeinate** so the Mac keeps serving with the lid closed.

This is machine configuration — it can't be scripted into the repo. Run it once
per Mac. Commands assume Apple Silicon Homebrew (`/opt/homebrew`); on Intel swap
in `/usr/local`.

## 0. Prerequisites

```bash
brew install cloudflared
cloudflared --version
```

You need a domain on a Cloudflare account (the free plan is enough) and pocket-t
installed (`bash install.sh` — puts `pocket` and `pt` in `/usr/local/bin`).

## 1. Authenticate cloudflared

```bash
cloudflared tunnel login
```

Opens a browser; pick the domain (zone) to authorize. Writes a cert to
`~/.cloudflared/cert.pem`.

## 2. Create a named tunnel

```bash
cloudflared tunnel create pocket-t
```

Prints a tunnel **UUID** and writes credentials to
`~/.cloudflared/<UUID>.json`. The name `pocket-t` is a label; the UUID is what
everything else references.

## 3. Route a DNS hostname to the tunnel

```bash
cloudflared tunnel route dns pocket-t pt.yourdomain.com
```

Creates a proxied `CNAME pt.yourdomain.com → <UUID>.cfargotunnel.com`.

## 4. Write the tunnel config

The daemon listens on `127.0.0.1:7700`. Point the tunnel's ingress at it:

```bash
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml <<'EOF'
tunnel: pocket-t
credentials-file: /Users/YOU/.cloudflared/<UUID>.json

ingress:
  - hostname: pt.yourdomain.com
    service: http://127.0.0.1:7700
  - service: http_status:404
EOF
```

Replace `/Users/YOU` and `<UUID>` with real values. Test in the foreground:

```bash
cloudflared tunnel run pocket-t
```

## 5. Install the tunnel as a boot LaunchDaemon

So the tunnel comes up at boot, before any user logs in:

```bash
sudo cloudflared service install
sudo launchctl print system/com.cloudflare.cloudflared >/dev/null && echo "loaded"
```

`service install` reads `~/.cloudflared/config.yml`, copies it to
`/etc/cloudflared/`, and registers a **LaunchDaemon**. Logs:
`/Library/Logs/com.cloudflare.cloudflared.{out,err}.log`. After editing the
config later, `sudo cloudflared service uninstall && sudo cloudflared service
install` to re-register.

## 6. Put Cloudflare Access in front (real auth)

A named tunnel is still open to the world until you gate it. In the Cloudflare
**Zero Trust** dashboard → **Access → Applications → Add an application →
Self-hosted**:

- Application domain: `pt.yourdomain.com`
- Add a **policy**: Action *Allow*, Include → *Emails* → your address (or a
  One-time PIN / your IdP). Everyone else gets a login wall.

Now the flow is: phone → Cloudflare edge → Access login (your identity) →
tunnel → `127.0.0.1:7700`. Your terminal is never directly exposed and never
reachable without authenticating.

> Optional hardening: create a **service token** for headless/API clients and
> add it to the same Access policy instead of exposing the UI publicly.

## 7. Start the pocket-t daemon on login

The repo ships a fixed LaunchAgent at
[`packages/daemon/launchd/app.pocket-t.daemon.plist`](../packages/daemon/launchd/app.pocket-t.daemon.plist).
It runs `pocket serve` (local-only; the tunnel from step 5 provides the public
edge) with `RunAtLoad` + `KeepAlive`.

```bash
# Copy into your LaunchAgents dir.
cp packages/daemon/launchd/app.pocket-t.daemon.plist \
   ~/Library/LaunchAgents/app.pocket-t.daemon.plist

# LaunchAgents get a minimal PATH — make sure the plist's EnvironmentVariables
# PATH includes where node/pnpm actually live:
which pnpm node cloudflared     # confirm these dirs are in the plist PATH

# Bootstrap it (bootout first so re-runs are idempotent).
launchctl bootout  gui/$(id -u)/app.pocket-t.daemon 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.pocket-t.daemon.plist
launchctl kickstart -k gui/$(id -u)/app.pocket-t.daemon

# Verify.
launchctl print gui/$(id -u)/app.pocket-t.daemon | grep -E 'state|path'
curl -sS http://127.0.0.1:7700/ >/dev/null && echo "daemon up"
tail -f /tmp/pocket-t-daemon.log        # ProgramArguments logs land here
```

If it flaps, the usual cause is PATH: the plist can't find `pnpm`/`node`. Edit
`EnvironmentVariables → PATH` in the plist to include the dirs from the `which`
above (LaunchAgents can't expand `$HOME`, so use literal absolute paths such as
`/Users/you/Library/pnpm`), then re-bootstrap.

## 8. Keep the Mac awake with the lid closed

A laptop sleeps on lid-close and the tunnel dies with it. `caffeinate` keeps the
system (and disk) awake. Wrap it in its own LaunchDaemon so it survives reboots:

```bash
sudo tee /Library/LaunchDaemons/app.pocket-t.caffeinate.plist >/dev/null <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>app.pocket-t.caffeinate</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>   <!-- prevent system sleep on AC power -->
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
sudo launchctl bootstrap system /Library/LaunchDaemons/app.pocket-t.caffeinate.plist
```

Clamshell/lid-closed operation on Apple Silicon also needs the Mac on **AC
power** (and, on some models, `sudo pmset -a disablesleep 1` — revert with
`disablesleep 0`). `caffeinate -s` only holds while on AC; drop `-s` for
`caffeinate -i` if you want it awake on battery too (watch your battery).

## Verify end-to-end

1. `curl https://pt.yourdomain.com/` from another network → Cloudflare Access
   login, then the pocket-t UI.
2. Reboot the Mac (don't log in). The tunnel LaunchDaemon should be up
   immediately; the daemon LaunchAgent starts at your login.
3. Close the lid on AC power → the URL still responds.

## Teardown

```bash
launchctl bootout gui/$(id -u)/app.pocket-t.daemon
rm ~/Library/LaunchAgents/app.pocket-t.daemon.plist
sudo launchctl bootout system /Library/LaunchDaemons/app.pocket-t.caffeinate.plist
sudo rm /Library/LaunchDaemons/app.pocket-t.caffeinate.plist
sudo cloudflared service uninstall
cloudflared tunnel delete pocket-t
```
