# Architecture

How Pocket-T turns every Mac terminal into a session you can drive from
a phone, without inbound ports, VPNs, or hosted infrastructure.

> **TL;DR.** A native shell proxy (`pt`) runs the user's shell — inside a
> private `tmux` server when tmux is present, so it survives the terminal
> closing — and tees its PTY to a daemon (`pt-registry`) that holds the
> session registry and persists it across restarts. Both the daemon and
> any browser dial OUT to either a Cloudflare Quick Tunnel (default) or a
> self-hosted ws-v3 hub. Frames flow over a single binary WebSocket
> protocol. A per-session vendor adapter (e.g. for Claude Code) turns raw
> PTY output into typed "bubble" events on top.

---

## The components

```
   ┌──────────────────────────────┐
   │  Mac                          │
   │                               │
   │   Terminal.app  ─ shell ─►  pt  ─── unix socket ───►  pt-registry
   │                            │                                │
   │                            ▼                                │
   │                       real shell                            │
   │                       (zsh / bash)                          │
   │                                                             │
   └─────────────────────────────────────────────────────────────┼────────┐
                                                                 │        │
                                                       outbound  │   outbound
                                                       WSS dial  │   WSS dial
                                                                 ▼        ▼
                                              ┌─────────────────────────────────┐
                                              │  Cloudflare Quick Tunnel        │
                                              │     OR  self-hosted ws-v3 hub   │
                                              │  (a dumb pipe — no state)       │
                                              └─────────────────────────────────┘
                                                                 ▲        ▲
                                                       outbound  │   outbound
                                                       WSS dial  │   WSS dial
                                                                 │        │
                                              ┌─────────────────────────┐ │
                                              │  Browser (phone, Mac,   │ │
                                              │  any device, any net)   │ │
                                              │                         │ │
                                              │  xterm.js + bubble UI ──┘
                                              │  + cost meter           │
                                              │  + 7 skins              │
                                              └─────────────────────────┘
```

| Component | Lives in | Lines | What it does |
|---|---|---:|---|
| **`pt`** (shell proxy) | `packages/pt-shim/src/` | ~1,080 | Native Rust binary (`main.rs` + `ipc.rs`). When `tmux` is on `PATH`, runs the user's shell inside a private `tmux -L pocket-t` session so it outlives the shim; otherwise `forkpty()`s the shell directly. Owns the PTY master, copies stdin↔master locally, tees output to the daemon over a Unix socket, accepts remote input / resize / kill frames. |
| **`pt-registry`** (daemon) | `packages/daemon/src/` | ~4,100 | TypeScript daemon. In-memory `Map<sessionId, PtSession>`, persisted to `~/.pocket-t/state.json` and rehydrated on restart. Three servers: pt-side Unix socket, ctl Unix socket (for CLI), browser HTTP + ws-v3. Bearer-token + Origin gate on the browser surface. Headless terminal per session for snapshot-on-attach. Per-session vendor adapter for bubble events. Asciinema recorder. PreToolUse hook server. Optional Web Push sender. |
| **`ws-v3-hub`** (relay) | `packages/relay/src/wsv3-hub.ts` | ~745 | Stateless WebSocket multiplexer. One file. No DB, no Redis, no JWT — daemons and browsers connect with the same shared-string token, frames are forwarded between same-token peers. Optional; only needed if the user wants a permanent URL. |
| **Web client** (PWA) | `packages/web-client/` | ~1,920 | Bubble-first, installable Svelte 5 PWA. Reconnecting ws-v3 socket (`partysocket`), lazy xterm.js Terminal tab, service worker with precache + Web Push handlers, web app manifest. The daemon serves its built `dist/` as the default browser client. |
| **Single-file client** | `packages/daemon/src/pt-registry/ui/index.html` | ~1,090 | One self-contained HTML page. xterm.js + `@xterm/addon-fit` for the terminal pane. Bubble view, mobile sidebar drawer + touch keyboard row, 7 CSS-variable skins. The daemon's fallback when the PWA `dist/` is absent, and the page the hub serves. |

Everything else (the homepage, the branding kit, the docs) is project
infrastructure, not runtime.

---

## How a session is born

The "every terminal you open is automatically a Pocket-T session" magic
is just: **the user picks `/usr/local/bin/pt` as their Terminal.app
shell.** From there:

1. Terminal.app launches `pt` as the shell of a new window.
2. `pt` resolves a **stable session id** — an env-carried
   `POCKET_T_SESSION_ID` if a supervisor pinned one, else a fresh UUID v4
   (never the pid, which changed every launch and made resume unreachable).
   It calls `forkpty()`, gets back `(child_pid, master_fd)`, and in the
   child chooses a persistence backend:
   - **tmux present** (the default when installed): `execvp`s
     `tmux -L pocket-t new-session -A -s pocket-t-<session_id>`. The
     private `pocket-t` tmux server owns the PTY and the login shell
     independently of `pt`, and `-A` means "attach if it exists, else
     create" — so the same command starts a new session *or* re-attaches a
     surviving one. `child_pid` here is only the attached tmux client.
   - **tmux absent**: `execvp`s the user's real shell (`$SHELL`, fallback
     `/bin/zsh` then `/bin/sh`) directly. The shell then shares `pt`'s
     lifetime, exactly like a plain login shell. Fully transparent
     fallback.
3. `pt` connects to the daemon's Unix socket at
   `~/.pocket-t/pt.sock`. If the daemon isn't running, that's fine —
   `pt` continues as a plain local shell. Fail-soft.
4. If connected, `pt` sends `HELLO` (protocol version) → `REGISTER`
   (sessionId, cwd, pid, geometry, shell name, and a flag marking whether
   the session is tmux-backed). The same stable sessionId is re-announced
   verbatim on every reconnect, so a daemon that restarted reattaches to
   this live shell instead of minting a new session.
5. `pt` enters its main loop: `poll(stdin, master_fd, daemon_socket)`.
   - stdin → master  (local typing → PTY → shell)
   - master → stdout (PTY → terminal you see)
   - master → daemon (PTY → STDOUT frames for any browser)
   - daemon → master (INPUT frames from browsers → PTY)
   - SIGWINCH → daemon (terminal resize → mirrored via RESIZE)

When the shell exits, `pt` sends EXIT with the exit code, closes the
socket, and quits. The daemon broadcasts `sessionRemoved` to every
attached browser. For a tmux-backed session this fires only when the
tmux session itself ends — merely quitting Terminal.app detaches the
client and leaves the shell running in the tmux server for later
re-attach (see [Persistence & rehydrate](#persistence--rehydrate)).

### Phone-spawned sessions

When a phone taps `+` in the browser sidebar, the browser sends an
EVENT frame `{ kind: 'spawnSession' }`. The daemon responds by
running:

```applescript
tell application "Terminal" to do script "exec /usr/local/bin/pt"
```

A new Terminal.app window opens on the Mac, runs `pt`, registers a
session — visible on both Mac and phone simultaneously.

---

## The IPC frame protocol (pt ↔ daemon)

Binary, length-prefixed, no library. See
[`packages/pt-shim/src/ipc.rs`](../packages/pt-shim/src/ipc.rs) for the
authoritative encoder/decoder.

```
[1 byte  type] [4 bytes length, big-endian] [N bytes payload]
```

| Dir | Type | Hex | Payload |
|---|---|---|---|
| pt → daemon | HELLO    | `0x01` | 1 byte protocol version |
| pt → daemon | REGISTER | `0x02` | JSON `{sessionId, cwd, pid, rows, cols, shell}` |
| pt → daemon | STDOUT   | `0x03` | raw PTY output bytes |
| pt → daemon | RESIZE   | `0x04` | `u16 rows, u16 cols` (big-endian) |
| pt → daemon | EXIT     | `0x05` | `i32 exit_code` (big-endian) |
| daemon → pt | ACK      | `0x10` | empty |
| daemon → pt | INPUT    | `0x11` | bytes to write into the PTY master |
| daemon → pt | KILL     | `0x12` | 1 byte signal number (1 = SIGHUP, 9 = SIGKILL, …) |
| daemon → pt | RESIZE_REMOTE | `0x13` | `u16 rows, u16 cols` (big-endian) |

`KILL` tears down the whole session, not just the attached client. For a
**tmux-backed** session `pt` runs `tmux -L pocket-t kill-session` (the
shell lives in the tmux server, not under `child_pid`), and the client
then hits PTY EOF and reports a clean exit. For a **direct** session it
signals the process group (`kill(-child_pid, sig)`) — `forkpty` calls
`setsid()`, so `child_pid` is the group leader and any agent the shell
spawned shares the pgid and exits together.

---

## The wire protocol (daemon / hub ↔ browser)

Lifted in shape from VibeTunnel and renamed: a single binary
WebSocket carrying multiplexed session streams.

```
[2 bytes magic ('P','T')] [1 byte version=3] [1 byte type]
[4 bytes sessionId length] [N bytes utf-8 sessionId]
[4 bytes payload length]   [N bytes payload]
```

| Type | Value | Direction | Payload |
|---|---:|---|---|
| HELLO       | 1  | client → server | 1 byte protocol version |
| WELCOME     | 2  | server → client | empty |
| SUBSCRIBE   | 10 | client → server | flags (u32 bitmask) + snapshot interval hints |
| UNSUBSCRIBE | 11 | client → server | empty |
| STDOUT      | 20 | server → client | PTY bytes |
| SNAPSHOT_VT | 21 | server → client | xterm.js serialised screen state |
| EVENT       | 22 | both directions | JSON-encoded typed payload (bubble, approvalDecision, spawnSession, …) |
| ERROR       | 23 | server → client | utf-8 error message |
| INPUT_TEXT  | 30 | client → server | typed bytes |
| INPUT_KEY   | 31 | client → server | typed bytes (reserved for keysym variants) |
| RESIZE      | 32 | client → server | `u32 cols, u32 rows` (little-endian) |
| KILL        | 33 | client → server | empty (daemon picks the signal) |
| PING/PONG   | 40/41 | both | empty |

Subscribe flags: `Stdout = 1`, `Snapshots = 2`, `Events = 4`. A typical
browser subscribes with all three set.

`SNAPSHOT_VT` is what makes mid-session attach feel native: the daemon
maintains a headless `xterm.js` instance per session, replays all PTY
output through it, and on subscribe serialises the resulting screen
state. The browser writes that into its own xterm before live STDOUT
takes over.

---

## Browser access control

The browser surface streams PTY bytes and injects keystrokes into live
sessions, so both the page and the WebSocket are gated. The daemon mints
a random bearer token (`crypto.randomBytes(32)`) once at startup, before
any server starts listening — an unminted (empty) token rejects
everything, so nothing is ever served ungated.

Two checks run at the HTTP layer:

1. **Bearer token.** The page `GET /` and the `/ws` upgrade must carry
   the token. It arrives as `?t=<token>` in the URL the daemon prints, an
   `Authorization: Bearer` header, or the `HttpOnly`, `SameSite=Strict`
   cookie the page route sets so the static client's handshake
   authenticates automatically. Comparison is constant-time. Tunnel
   traffic reaches the daemon over loopback (cloudflared dials
   `localhost`), so it is indistinguishable from a local socket — the
   token is therefore required unconditionally, with no remote-address
   exemption.
2. **Origin allowlist.** The `/ws` upgrade is refused unless the request
   `Origin` is same-origin with the `Host`, or a known loopback / tunnel
   / relay host (seeded at startup and extended with the tunnel host once
   it's known). A foreign site's Origin never matches, so a drive-by page
   can't open a socket even before the token check.

A **relay** peer is different: it reaches the daemon through the hub's
outbound pipe with no HTTP handshake to gate. Such a client starts
unauthenticated and may send only `HELLO` (which carries the token) and
`PING` until it authenticates; every privileged frame — subscribe,
input, resize, kill, spawn — is dropped, and it receives no session
catalog or PTY bytes, until its `HELLO` presents a matching token.

The Unix sockets (`pt.sock`, `ctl.sock`) are `chmod 0700`, so only the
owning user can connect to the pt-side and control channels.

---

## Vendor adapters → bubble events

Plain terminal sessions render as raw xterm.js. Agent CLIs get an
additional **bubble layer** that turns their natural side-channel into
typed events.

```
                                       ┌─→  raw PTY bytes  (always)
session                                │
output  ──► daemon (PtSession) ────────┤
                                       │
                                       └─→  vendor adapter ──► typed BubbleEvent[]
                                                                  │
                                       ┌──────────────────────────┘
                                       │
                                       ▼
                          { kind: 'chat'     | 'thought'
                                  | 'action' | 'tool_result'
                                  | 'approval'
                                  | 'cost'   | 'error' }
```

Today the only fully-implemented adapter is `ClaudeAdapter`. It tails
`~/.claude/projects/<slug>/<session>.jsonl` (Claude Code's own
transcript file), maps each content block to a bubble, and emits cost
events from each turn's `usage` block (priced from
[`pricing.ts`](../packages/daemon/src/adapters/pricing.ts)).

`GenericAgentAdapter` is the fallback for any vendor whose name appears
in the session's process tree (`codex`, `openclaw`, `hermes`, …) but
which doesn't have a dedicated parser yet — it emits a single
onboarding bubble explaining the situation and lets the Terminal view
keep working unchanged.

Adapters never sit in the PTY hot path. They watch side-channels
(transcript files, process tree, OSC markers) and emit events on their
own EventEmitter. The daemon broadcasts those as `EVENT` frames with
`{ kind: 'bubble', sessionId, event }`.

Adding a new vendor:

1. Implement the `Adapter` interface in `packages/daemon/src/adapters/`
   (mirror `ClaudeAdapter.ts`).
2. Add the vendor name to `KNOWN_VENDORS` in
   [`adapters/detect.ts`](../packages/daemon/src/adapters/detect.ts).
3. Map your vendor's session shape into `BubbleEvent`s.

---

## Persistence & rehydrate

Two independent layers let a session outlive the things that used to kill
it — Terminal.app quitting, logout, and a daemon restart.

**tmux owns the shell.** When `tmux` is installed the shell runs in the
private `pocket-t` tmux server (`tmux -L pocket-t`), which keeps the PTY
and the shell alive regardless of whether any `pt` client is attached.
Quitting the terminal only detaches the client; the shell — and any agent
in it — keeps running. `packages/pt-shim/src/main.rs` and the daemon's
[`state.ts`](../packages/daemon/src/pt-registry/state.ts) share the
`pocket-t` server label and the deterministic `pocket-t-<sessionId>`
naming so each side can find the other's sessions.

**state.json survives the daemon.** The in-memory registry is snapshotted
to `~/.pocket-t/state.json` — written atomically (temp file → `fsync` →
`rename`, `0600`) so a crash mid-write can never wipe the catalog. Each
persisted record carries the session metadata (cwd, pid, geometry,
vendor, timestamps, the tmux flag) plus two things that make a re-attach
feel live: the **last serialized VT screen** (from the headless
terminal's serialize addon) and a **bounded tail of adapter events** (the
most recent bubbles and the latest cost update).

On startup `rehydrateSessions()` rebuilds the catalog from both sources:

1. For each record in `state.json`, decide liveness: a **tmux-backed**
   session is alive if its `pocket-t-<id>` tmux session still exists; a
   **direct** session is alive only if its shim pid is still running.
   Dead entries are dropped.
2. A surviving session is re-added with its snapshot written back into a
   fresh headless terminal (so a browser attaching post-restart is painted
   the last frame) and its event tail restored (so the conversation and
   running cost continue). A 60-second grace timer covers the window
   before the shim re-dials.
3. If the shim really died while the daemon was down but the **tmux
   session is still alive**, the daemon re-pipes it by spawning a headless
   `pt` (`POCKET_T_HEADLESS=1`, `POCKET_T_SESSION_ID=<id>`) that attaches
   to the surviving tmux session and streams it back. Any live tmux
   session not covered by `state.json` (e.g. the file was lost) is adopted
   the same way.

The one thing no layer provides is surviving a literal **reboot** — a
process can't outlive the kernel that ran it. That's an opt-in setup step
(launchd auto-start + `tmux-resurrect`/`tmux-continuum`), documented in
[`always-on-setup.md`](always-on-setup.md).

## Push notifications

Approvals are the one event that can't wait for you to happen to be
looking. When a PreToolUse hook flags a tool call and **no browser is
subscribed to that session's events**, the daemon fires a Web Push so the
request reaches your phone.

```
PreToolUse hook ─► daemon flags approval
                         │
                         ├─ live ws watcher? ──► approval card in the browser
                         │
                         └─ nobody watching ──► PushService.notify()
                                                     │  web-push + VAPID
                                                     ▼
                                          browser push service (Apple/Google)
                                                     │
                                                     ▼
                                    PWA service worker 'push' → showNotification
                                                     │ tap
                                                     ▼
                                       /?session=<id>  (deep-link to session)
```

The server half is
[`packages/daemon/src/pt-registry/push.ts`](../packages/daemon/src/pt-registry/push.ts):
a `PushService` that holds the VAPID **private** key, stores device
subscriptions in `~/.pocket-t/push-subscriptions.json` (atomic write,
`0600`), and POSTs notifications via the `web-push` library. It is built
only when `POCKET_T_VAPID_PUBLIC_KEY` + `POCKET_T_VAPID_PRIVATE_KEY` are
set (optional `POCKET_T_VAPID_SUBJECT` contact URI); with no keys the
service is null and every entry point is a no-op.

Devices register through the token-gated `POST /push/subscribe` on the
browser server, which hands the raw `PushSubscription` to
`addSubscription()`. The client half — the service worker `push` /
`notificationclick` handlers and the subscribe helper keyed on the
build-time `VITE_VAPID_PUBLIC_KEY` — lives in the web client
(`packages/web-client/src/sw.ts`, `src/lib/push.ts`). Dead subscriptions
(the push service returns 404/410) are pruned on the next send.

## Recording (asciinema v2)

Every Pocket-T session writes a standard
[asciinema v2 cast file](https://github.com/asciinema/asciinema/blob/master/doc/asciicast-v2.md)
to `~/.pocket-t/recordings/<sessionId>.cast`. Header on session start,
one record per PTY chunk after that:

```jsonl
{"version":2,"width":80,"height":24,"timestamp":1779343234,"title":"pocket-t pt-XXXX","env":{"SHELL":"/bin/zsh","TERM":"xterm-256color"},"x-pocket-t":{"cwd":"/Users/you"}}
[0.002, "o", "hello"]
[0.075, "i", "x"]
[0.075, "r", "120x30"]
[0.075, "o", " world\n"]
```

The `i` (input) and `r` (resize) records are extensions some players
ignore — that's fine, they degrade to plain output. `pt-registry
replay <sessionId>` replays at native speed using only `o` records;
any external asciinema player works on the same files.

Recording is **opt-in** (`POCKET_T_RECORD=1`) — the casts capture every
keystroke, including anything typed at a password prompt, so they only
exist when you ask for them, and land in an owner-only (`0700`)
`~/.pocket-t/recordings/`. Writing is best-effort: a failed `fs.openSync`
disables the recorder for that session and logs once. Sessions never get
held up because the disk filled.

---

## Reaching the browser

The daemon binds its browser server to `127.0.0.1:7700` only. For
cross-network access, both the daemon AND the browser dial OUT to a
public relay. Two flavours:

### Default: Cloudflare Quick Tunnel

```
pocket
```

Equivalent to `pt-registry serve --tunnel`. Spawns
`cloudflared tunnel --url http://localhost:7700` as a child process,
captures the printed `*.trycloudflare.com` URL, appends the daemon's
access token (`?t=<token>`), writes the tokenized link to an owner-only
`~/.pocket-t/tunnel-url`, and renders a QR code in the terminal. The
printed URL carries the required token, so the daemon's token + Origin
gate applies to tunnel traffic exactly as it does locally. For a stable
hostname, pay once with a Cloudflare account and a named tunnel (see
[`always-on-setup.md`](always-on-setup.md)).

### Self-hosted: ws-v3 hub

```
docker compose -f infra/docker-compose.yml up -d
pocket serve --relay "wss://your-domain/ws/pt?role=daemon&t=<token>"
```

The hub is a single ~745-line file. It accepts two roles on
`/ws/pt?role=…&t=…`:

```
ws://hub/ws/pt?role=daemon&t=<token>   ← pt-registry dials in
ws://hub/ws/pt?role=client&t=<token>   ← browser dials in
```

Any frame received from a `daemon` is forwarded to every `client`
under the same token, and vice versa. The hub never inspects payloads,
never holds state, never has a database — it's the smallest
multiplexer that does the job. Same architecture as production-grade
relays, just stripped to essentials.

---

## Per-session lifecycle

The daemon's `PtSession` holds (in-memory only):

```typescript
{
  sessionId, cwd, pid, rows, cols, shell,
  registeredAt, lastActiveAt,
  bytesIn, bytesOut,            // PTY → daemon, daemon → PTY
  socket,                        // pt-side Unix socket (null when rehydrated, awaiting reconnect)
  headless,                      // xterm.js instance for snapshots
  serializer,                    // addon-serialize on the headless
  adapter, vendor,               // attached after tryBindAdapter resolves
  events: BubbleEvent[],         // ring buffer of replayable history
  recorder,                      // asciinema writer
  tmux,                          // true when the shell runs in the pocket-t tmux server
  detached, detachedAt, detachTimer,
  pendingApprovals: Map<approvalId, PendingApproval>,
}
```

When the `pt` socket drops without a clean `FRAME_EXIT`, the daemon
marks the session **detached** and starts a 60-second grace timer.
If a new `pt` registers with the same sessionId before it fires, the
socket gets swapped in and history continues. What happens if the timer
expires depends on `tmux`: a **tmux-backed** session whose tmux session
is still alive is re-piped through a headless `pt` (the shell never
died); a **direct** session with no reconnect is torn down for real and
all attached browsers see `sessionRemoved`. The catalog is snapshotted to
`state.json` so the same session survives a daemon restart, not just a
shim reconnect (see [Persistence & rehydrate](#persistence--rehydrate)).

---

## Process model

```
$ ps -ef | grep pt | grep -v grep
501 pt-registry serve --tunnel          ← the daemon (Node)
501  └─ cloudflared tunnel --url …      ← spawned by --tunnel
501 /usr/local/bin/pt                   ← per Terminal.app window
501  └─ -zsh                            ← user's real shell
501     └─ claude                       ← whatever the user runs
```

One daemon. One `cloudflared` (if `--tunnel`). One `pt` per Terminal
window. The PTY hierarchy is set up by `forkpty()` in `pt` — the shell
gets its own session and controlling TTY; `kill(-shell_pid, SIGHUP)`
cleanly hangs everything up.

---

## Comparison to neighbours

| | Pocket-T | VibeTunnel | SSH apps | Telegram bots | Tailscale + viewer |
|---|---|---|---|---|---|
| Cross-network | ✅ tunnel (free) | ✅ Tailscale | ✅ SSH | ✅ relay | ✅ VPN |
| Every terminal auto | ✅ | ✅ | ❌ (you connect each one) | ❌ | ❌ |
| Real rendered screen | ✅ | ✅ | ✅ | ❌ chat lines | ✅ |
| Tool-call approval | ✅ | ❌ | ❌ | ❌ stalls | ❌ |
| Agent-aware bubbles | ✅ | ❌ | ❌ | ❌ | ❌ |
| Live cost meter | ✅ | ❌ | ❌ | ❌ | ❌ |
| Session recording | ✅ asciinema | ✅ asciinema | ❌ | ❌ | ❌ |
| Hosted infra | none needed | Tailscale | (yours) | bot host | Tailscale |
| Apple Silicon | ✅ | ✅ | ✅ | ✅ | ✅ |
| Linux | not yet (PR welcome) | ✅ | ✅ | ✅ | ✅ |

Pocket-T's distinct contribution is the **bubble layer + cost meter +
zero-infra default**. The terminal-mirroring core is the kind of thing
VibeTunnel proved was viable; the agent-aware UI on top is new.

---

## Where the code lives

```
packages/
├── pt-shim/           Native Rust shell proxy (~1,080 LOC)
│   ├── src/main.rs    forkpty / tmux backing + raw-mode + copy loop + SIGWINCH
│   ├── src/ipc.rs     daemon Unix socket protocol
│   └── scripts/install.sh   build + ad-hoc codesign + sudo cp
│
├── daemon/            TypeScript runtime (~4,100 LOC + UI)
│   ├── launchd/app.pocket-t.daemon.plist   login LaunchAgent (always-on)
│   └── src/
│       ├── main.ts                  top-level `pocket-t` CLI wrapper
│       ├── pt-registry/
│       │   ├── main.ts              entry → runs cli.main()
│       │   ├── server.ts            runServer + sub-servers + auth gate + rehydrate
│       │   ├── state.ts             state.json persistence + tmux helpers + instance lock
│       │   ├── push.ts              Web Push sender (VAPID) + subscription store
│       │   ├── cli.ts               list / status / pending / approve / …
│       │   ├── recorder.ts          asciinema v2 writer
│       │   ├── tunnel.ts            cloudflared spawn + QR + URL capture
│       │   └── ui/index.html        fallback single-file browser page (~1,090 LOC)
│       ├── adapters/
│       │   ├── Adapter.ts           BubbleEvent type, Adapter interface
│       │   ├── ClaudeAdapter.ts     transcript tailer → bubble events
│       │   ├── GenericAgentAdapter.ts   fallback "vendor detected" bubble
│       │   ├── detect.ts            vendor detection (transcript + process tree)
│       │   └── pricing.ts           per-model $ for Claude, GPT-5, Grok
│       └── hooks/HookServer.ts      Claude PreToolUse HTTP endpoint
│
├── web-client/        Bubble-first Svelte PWA (~1,920 LOC), served from dist/
│   └── src/
│       ├── App.svelte              shell: sidebar + bubbles/terminal tabs + composer
│       ├── lib/connection.ts       reconnecting ws-v3 client (partysocket)
│       ├── lib/push.ts             client subscribe against VITE_VAPID_PUBLIC_KEY
│       └── sw.ts                   service worker: precache + push + notificationclick
│
├── relay/             Self-hosted ws-v3 hub (~745 LOC, one file)
│   └── src/wsv3-hub.ts
│
└── shared/            Wire-format types used by daemon + hub
    └── src/ws-v3.ts   binary frame encoder/decoder
```

Each runtime package is independently buildable and testable. The
shared package exports types only.

---

## Next

If something here doesn't match what the code does, the code wins —
file an issue. If something here is missing, send a PR to this doc;
it's a small file with focused sections.
