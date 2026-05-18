# Socket.IO protocol

Source of truth: `packages/shared/src/protocol.ts`. Two namespaces:
`/daemon` (daemon ↔ relay, JWT auth) and `/client` (browser ↔ relay,
cookie auth). Every event payload is `(p: T) => void`.

Events marked **V2** exist in the type definitions but are **not wired**
(no relay handler). E2E and team features are not implemented yet.

## Daemon → Relay (`DaemonEmitEvents`)

| Event | Payload |
|-------|---------|
| `daemon:sessions` | `{ sessions: Session[] }` — full list on connect |
| `daemon:session:update` | `{ session: Partial<Session> & { id } }` |
| `daemon:session:chunk` | `{ sessionId, text, rawVt, seq }` — readable text + base64 VT |
| `daemon:session:snapshot` | `{ sessionId, plainText, rawVt }` — current screen on attach |
| `daemon:session:approval` | `{ sessionId, messageId, options: ApprovalOption[] }` |
| `daemon:session:exit` | `{ sessionId, exitCode }` |
| `daemon:hook:approval` | `{ approvalId, sessionId, toolName, toolInput }` — blocking PreToolUse gate |
| `daemon:session:chunk:encrypted` **V2** | `{ sessionId, encrypted: EncryptedChunk, seq }` |

## Relay → Daemon (`RelayToDaemonEvents`)

| Event | Payload |
|-------|---------|
| `relay:cmd:input` | `{ sessionId, text }` — raw text; submit (Enter) is owned by the daemon |
| `relay:cmd:spawn` | `{ name, cmd, cwd }` |
| `relay:cmd:kill` | `{ sessionId, signal? }` |
| `relay:cmd:attach` | `{ sessionId }` — request a snapshot |
| `relay:cmd:approveHook` | `{ approvalId, decision: 'approve' \| 'deny' }` |
| `relay:cmd:input:encrypted` **V2** | `{ sessionId, encrypted }` |

All command events are emitted to the owning daemon's room
(`daemon:<id>`), not the account.

## Client → Relay (`ClientEmitEvents`)

| Event | Payload |
|-------|---------|
| `client:session:attach` | `{ sessionId, lastSeq? }` — joins `session:<id>`, returns history |
| `client:session:detach` | `{ sessionId }` |
| `client:session:input` | `{ sessionId, text }` |
| `client:approval:respond` | `{ sessionId, messageId, choice }` — `choice` must be a stored option key |
| `client:session:spawn` | `{ name, cmd, cwd }` |
| `client:session:kill` | `{ sessionId, signal? }` |
| `client:push:subscribe` | `{ endpoint, p256dh, auth }` |
| `client:hook:approve` | `{ approvalId, sessionId, decision }` |
| `client:session:input:encrypted` **V2** | `{ sessionId, encrypted }` |

## Relay → Client (`RelayToClientEvents`)

| Event | Payload |
|-------|---------|
| `relay:sessions` | `{ sessions }` |
| `relay:session:update` | `{ session }` |
| `relay:session:chunk` | `{ sessionId, text, rawVt, seq }` |
| `relay:session:history` | `{ sessionId, messages, hasMore }` |
| `relay:session:snapshot` | `{ sessionId, plainText, rawVt }` |
| `relay:daemon:status` | `{ daemonId, online }` |
| `relay:error` | `{ code, message }` — `RATE_LIMITED`, `BAD_INPUT`, `NOT_FOUND`, `NO_DAEMON` |
| `relay:hook:approval` | `{ approvalId, sessionId, toolName, toolInput }` |
| `relay:session:chunk:encrypted` **V2** | `{ sessionId, encrypted, seq }` |
| `relay:approval:resolved` **V2** | `{ sessionId, messageId, choice, resolvedBy }` |

## `EncryptedChunk` (V2, unused)

`{ iv: string, data: string, tag: string }` — all hex, AES-GCM. Defined
for a future E2E transport where the relay routes ciphertext; there is no
encrypt/decrypt path in the current code.
