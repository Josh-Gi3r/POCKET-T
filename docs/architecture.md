# Architecture

How Pocket-T turns every Mac terminal into a session you can drive from
a phone, without inbound ports, VPNs, or hosted infrastructure.

> **TL;DR.** A native shell proxy (`pt`) owns the user's PTY. A daemon
> (`pt-registry`) holds the in-memory session registry. Both the daemon
> and any browser dial OUT to either a Cloudflare Quick Tunnel (default)
> or a self-hosted ws-v3 hub. Frames flow over a single binary
> WebSocket protocol. A per-session vendor adapter (e.g. for Claude
> Code) turns raw PTY output into typed "bubble" events on top.

---

## The four components

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
| **`pt`** (shell proxy) | `packages/pt-shim/src/main.rs` | ~700 | Native Rust binary. `forkpty()`s the user's shell, owns the PTY master, copies stdin↔master locally, tees output to the daemon over a Unix socket, accepts remote input / resize / kill frames. |
| **`pt-registry`** (daemon) | `packages/daemon/src/pt-registry/` | ~2,800 | TypeScript daemon. In-memory `Map<sessionId, PtSession>`. Three servers: pt-side Unix socket, ctl Unix socket (for CLI), browser HTTP + ws-v3. Headless terminal per session for snapshot-on-attach. Per-session vendor adapter for bubble events. Asciinema recorder. PreToolUse hook server. |
| **`ws-v3-hub`** (relay) | `packages/relay/src/wsv3-hub.ts` | ~580 | Stateless WebSocket multiplexer. One file. No DB, no Redis, no JWT — daemons and browsers connect with the same shared-string token, frames are forwarded between same-token peers. Optional; only needed if the user wants a permanent URL. |
| **Browser UI** | `packages/daemon/src/pt-registry/ui/index.html` | ~975 | One self-contained HTML page. xterm.js + `@xterm/addon-fit` for the terminal pane. Bubble view for agent-aware rendering. Mobile sidebar drawer + touch keyboard row. 7 CSS-variable skins. Served by the daemon and (verbatim) by the hub. |

Everything else (the homepage, the branding kit, the docs) is project
infrastructure, not runtime.

---

## How a session is born

The "every terminal you open is automatically a Pocket-T session" magic
is just: **the user picks `/usr/local/bin/pt` as their Terminal.app
shell.** From there:

1. Terminal.app launches `pt` as the shell of a new window.
2. `pt` calls `forkpty()`, gets back `(child_pid, master_fd)`, `execvp`s
   the user's real shell (`$SHELL`, fallback `/bin/zsh`) in the child.
3. `pt` connects to the daemon's Unix socket at
   `~/.pocket-t/pt.sock`. If the daemon isn't running, that's fine —
   `pt` continues as a plain local shell. Fail-soft.
4. If connected, `pt` sends `HELLO` (protocol version) → `REGISTER`
   (sessionId, cwd, pid, geometry, shell name).
5. `pt` enters its main loop: `poll(stdin, master_fd, daemon_socket)`.
   - stdin → master  (local typing → PTY → shell)
   - master → stdout (PTY → terminal you see)
   - master → daemon (PTY → STDOUT frames for any browser)
   - daemon → master (INPUT frames from browsers → PTY)
   - SIGWINCH → daemon (terminal resize → mirrored via RESIZE)

When the shell exits, `pt` sends EXIT with the exit code, closes the
socket, and quits. The daemon broadcasts `sessionRemoved` to every
attached browser.

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

`KILL` is sent to the process group (`kill(-child_pid, sig)`) so the
whole shell session — including any agent the shell spawned — exits
together.

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

## Recording (asciinema v2)

Every Pocket-T session writes a standard
[asciinema v2 cast file](https://github.com/asciinema/asciinema/blob/master/doc/asciicast-v2.md)
to `~/.pocket-t/recordings/<sessionId>.cast`. Header on session start,
one record per PTY chunk after that:

```jsonl
{"version":2,"width":80,"height":24,"timestamp":1779343234,"title":"pocket-t pt-XXXX","env":{"SHELL":"/bin/zsh","TERM":"xterm-256color"},"x-pocket-t":{"cwd":"/Users/josh"}}
[0.002, "o", "hello"]
[0.075, "i", "x"]
[0.075, "r", "120x30"]
[0.075, "o", " world\n"]
```

The `i` (input) and `r` (resize) records are extensions some players
ignore — that's fine, they degrade to plain output. `pt-registry
replay <sessionId>` replays at native speed using only `o` records;
any external asciinema player works on the same files.

Recording is **on by default** and best-effort: a failed `fs.openSync`
disables the recorder for that session and logs once. Sessions never
get held up because the disk filled.

---

## Reaching the browser

The daemon binds its browser server to `127.0.0.1:7700` only. For
cross-network access, both the daemon AND the browser dial OUT to a
public relay. Two flavours:

### Default: Cloudflare Quick Tunnel

```
pt-registry serve --tunnel
```

Spawns `cloudflared tunnel --url http://localhost:7700` as a child
process, captures the printed `*.trycloudflare.com` URL, writes it to
`~/.pocket-t/tunnel-url` and renders a QR code in the terminal. The
URL is unauthenticated but unguessable; restart-resistant by paying
once for a Cloudflare account + a named tunnel.

### Self-hosted: ws-v3 hub

```
docker compose -f infra/docker-compose.yml up -d
pt-registry serve --relay wss://your-domain/ws/pt?role=daemon&t=<token>
```

The hub is a 580-line file. It accepts two roles on
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
  socket,                        // pt-side Unix socket
  headless,                      // xterm.js instance for snapshots
  serializer,                    // addon-serialize on the headless
  adapter, vendor,               // attached after tryBindAdapter resolves
  events: BubbleEvent[],         // ring buffer of replayable history
  recorder,                      // asciinema writer
  detached, detachedAt, detachTimer,
  pendingApprovals: Map<approvalId, PendingApproval>,
}
```

When the `pt` socket drops without a clean `FRAME_EXIT`, the daemon
marks the session **detached** and starts a 60-second grace timer.
If a new `pt` registers with the same sessionId before it fires, the
socket gets swapped in and history continues. Otherwise the session is
torn down for real and all attached browsers see `sessionRemoved`.

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
├── pt-shim/           Native Rust shell proxy (~700 LOC)
│   ├── src/main.rs    forkpty + raw-mode + copy loop + SIGWINCH
│   ├── src/ipc.rs     daemon Unix socket protocol
│   └── scripts/install.sh   build + ad-hoc codesign + sudo cp
│
├── daemon/            TypeScript runtime (~2,800 LOC)
│   └── src/
│       ├── main.ts                  top-level `pocket-t` CLI wrapper
│       ├── pt-registry/
│       │   ├── main.ts              entry → runs cli.main()
│       │   ├── server.ts            runServer + sub-servers
│       │   ├── cli.ts               list / status / pending / approve / …
│       │   ├── recorder.ts          asciinema v2 writer
│       │   ├── tunnel.ts            cloudflared spawn + QR + URL capture
│       │   └── ui/index.html        the served browser page (~975 LOC)
│       ├── adapters/
│       │   ├── Adapter.ts           BubbleEvent type, Adapter interface
│       │   ├── ClaudeAdapter.ts     transcript tailer → bubble events
│       │   ├── GenericAgentAdapter.ts   fallback "vendor detected" bubble
│       │   ├── detect.ts            vendor detection (transcript + process tree)
│       │   └── pricing.ts           per-model $ for Claude, GPT-5, Grok
│       └── hooks/HookServer.ts      Claude PreToolUse HTTP endpoint
│
├── relay/             Self-hosted ws-v3 hub (~580 LOC, one file)
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
