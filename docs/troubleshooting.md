# Troubleshooting

## No sessions show up on the phone

- Open a **new** terminal after install (existing shells haven't sourced
  the snippet). `echo $TMUX` inside it should be non-empty.
- Check the daemon: `tail -f /tmp/pocket-t-daemon.log /tmp/pocket-t-daemon.err`.
- Confirm it authenticated: `~/.pocket-t/config.json` has `daemonId` /
  `accountId`. Re-run `pocket-t auth <token>` if not.
- The Mac shows offline until the daemon's WS connects — verify
  `POCKET_T_RELAY_URL` points at your relay (self-host) and the relay's
  `/healthz` returns `{"ok":true}`.

## A new terminal closes instantly / shell feels broken

The snippet is fail-safe and should fall through to a normal shell if
tmux can't start. If a terminal still misbehaves, open one with capture
disabled and investigate:

```bash
POCKET_T_NO_ATTACH=1 zsh
tmux -L pocket-t kill-server      # reset the isolated server
```

If you need a clean shell immediately, run the uninstaller
([uninstall.md](uninstall.md)) — it strips the snippet from your rc files.

## Approvals never reach the phone

Claude Code's PreToolUse hook tags requests with the pane via
`$TMUX_PANE`. It only works for Claude Code running **inside** a captured
pocket-t terminal. Confirm `~/.claude/settings.json` contains the
pocket-t `preToolUse` hook (the daemon writes it on start) and that
Claude Code is running in a pocket-t pane (`echo $TMUX_PANE`).

## Output looks wrong / frozen

Live output now follows automatically; if a screen looks stale, pull-to-
top reloads history. A persistent "Reconnecting…/Offline" banner means
the socket is down — REST is fine but realtime won't update until it
recovers.

## Production deploy: login works but nothing streams

A static (e.g. Vercel) web deploy has no proxy. REST `/api` is proxied to
the relay via `vercel.json`, but the realtime socket must hit the relay
origin directly — set `VITE_RELAY_URL` at build time
(see [self-hosting.md](self-hosting.md)). Without it the socket tries
same-origin and never connects.

## Daemon won't start (self-host)

The relay refuses to boot if required env (`DATABASE_URL`, `REDIS_URL`,
secrets) is missing. Billing/team modules are loaded only when
`POCKET_T_PHASE2=1`, so a missing `STRIPE_SECRET_KEY` no longer crashes
the relay.
