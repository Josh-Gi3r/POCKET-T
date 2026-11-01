# Pocket-T 2 — Telegram fallback control channel

**Decision:** Build a Telegram Bot API adapter alongside the primary mobile-first Pocket-T web app. This is a **secondary interface, not a second backend**, and is not yet implemented or deployed. It must preserve the project's non-negotiables in `docs/pocket-t-2-architecture.md`: OpenAI cloud intelligence, restricted-network support where explicitly permitted, discovery of already-existing terminals, and user-authorised desktop control.

## Why

Some phones and networks may fail to load Pocket-T's browser domain even when Telegram is accessible; some managed Macs may block AI websites including ChatGPT. A Telegram bot offers a low-bandwidth, familiar chat interface that does not require the controlled Mac to reach Telegram or OpenAI directly.

The bot **does not bypass a Mac's network policies**: the companion still needs an approved authenticated connection to the Pocket-T control plane. If both the Mac connection and all approved alternative transports are unavailable, display `Machine offline — no remote operations possible`. Don't offer deceptive actions.

## Shared architecture

```
iPhone PWA / desktop web ----- HTTPS/WebSocket -----┐
                                                    ├── Cloudflare Pocket-T gateway
iPhone Telegram bot -- Telegram webhook (HTTPS) ----┘      | authenticated identity,
                                                           | same policy engine,
                                                           | task state / receipts
                                                           v
                                            OpenAI orchestration service
                                            (Responses + transcription)
                                                           |
                                            per-machine authorized command bus
                                                           |
                                            Mac companion (outbound)
                                              - managed pt terminal
                                              - existing terminal adapters
                                              - optional consented screen/UI APIs
```

- A single `CommandService` exposes typed actions: `listMachines`, `listSessions`, `getStatus`, `summarize`, `sendAgentPrompt`, `getApproval`, `decideApproval`, `getCommandReceipt` and `requestWebHandoff`. Never send unchecked model text directly to a shell.
- The Telegram adapter maps natural-language messages, voice notes, bot commands and inline callback buttons into those shared commands and returns the same **actual operation receipts** as the web app.
- OpenAI is the cloud brain for natural-language interpretation, speech transcription, multi-step work, and concise grounded summaries. Telegram must remain able to return deterministic `/status` and `/help` when the OpenAI API is temporarily unavailable (explicitly label AI features unavailable).
- Use a Cloudflare Worker HTTPS webhook for incoming Telegram updates; validate `X-Telegram-Bot-Api-Secret-Token`, update_id deduplication, expected update schema, and a bounded body. Respond quickly; queue actual work in Durable Objects / Cloudflare Queues. Don't perform a long model call inline in Telegram's webhook request.
- Outbound Telegram replies use `sendMessage`, `editMessageText`, `answerCallbackQuery`; use `sendPhoto` only for specifically approved, redacted previews.

## Why a true Telegram bot rather than only a Mini App

A Telegram Mini App is another webpage embedded in Telegram. If the web host/domain is blocked, Mini App loading may fail too. The fallback must work using **ordinary bot chat messages, voice notes, and inline keyboards** without a separate webview. The Mini App can be an optional enhancement, never a dependency.

## Mobile-oriented Telegram MVP

Start from a private 1:1 conversation, no groups or public channels. Provide:

- `/start` — private one-time pairing instructions (initiated from the authenticated Pocket-T web app or Mac, never a shared static password).
- `/machines` — online/offline status and last heartbeat. One-tap select.
- `/sessions` — all known managed and discovered sessions with exact provenance and capability labels (`full PTY`, `snapshot only`, `discovered read-only`).
- `/status` — current tasks, running agents, failed builds, and approvals; data must be evidence-backed, not invented by the model.
- `/pending` — pending approvals with inline **Review** / **Reject** and a safe link/step-up path for high-impact actions.
- `/stop` — ask to stop a selected owned task; require confirmation when it could terminate active work.
- Free-text: `What is stuck on my Mac?`; `Check the tests for project X`; `Tell me what Codex is doing`.
- Voice messages: fetch via Telegram `getFile` and transcribe using OpenAI's supported audio input format; convert if the received codec is unsupported. Show the interpreted command and ask for confirmation before high-impact work.
- Progress updates: replace the existing `working…` status message with real state transitions; not a stream of noisy debug output.
- Handoff button: `Open full workspace` for diffs, multi-pane terminals, screen sharing and desktop control; absent/disabled when the web app cannot load.

Example response:

```
Pocket-T · Your Mac
● Online · last heartbeat 6s ago

2 active agents · 5 existing terminals
1 request needs you · 1 test job failed

[Review request] [See sessions]
[Summarise work] [Refresh]
```

Don't claim these are real statuses before the machine reports them.

## Security

**Telegram bot conversations are Telegram cloud chats, not end-to-end-encrypted Secret Chats.** Treat Telegram as a low-trust display and action channel. Never send full terminal logs, raw enterprise documents, passwords, API keys, tokens or unrestricted screen captures by default.

- Pair an exact Telegram `from.id` **and** expected private `chat.id` to one Pocket-T account using a one-use, short-expiry pairing challenge; reject all unauthorised accounts and group chats.
- Validate webhook secret, Telegram sender/chat IDs, account policy, machine identity, target session capability and risk class on **every** request/callback. Do not use usernames alone for identity.
- Inline buttons hold only an opaque one-use operation ID (not a shell command or access token). Keep `callback_data` short enough for Telegram's 64-byte limit. Resolve on server, bound to Telegram identity, target, approval decision, nonce and TTL. Call `answerCallbackQuery`.
- For low-risk operations: show output redacted and bounded. For write/mutation actions: display intended target and command and require explicit confirmation. For high-risk operations (remote desktop enabling, security settings, deleting files, publishing/deploying, credential actions): step-up auth through the trusted app or locally on the Mac; do **not** allow a single Telegram click to silently grant full control.
- Disable group chats, arbitrary shell access, device credential distribution and automatic file/screenshot uploads for first release.
- Do not forward protected terminal data to OpenAI or Telegram absent the machine's disclosure policy; OpenAI is essential to the product but subject to explicit per-machine classification.
- Keep a bounded immutable audit record of sender, decision, operation ID, target machine, verdict and receipt (metadata, not secret-bearing plaintext).
- Device disconnection must invalidate pending interactive screen-control sessions. Queue safe reads only if appropriate; mutating commands never execute later without a fresh confirmation.

## What it solves and what it doesn't

| Failure mode | Telegram fallback |
|---|---|
| Pocket-T browser blocked on phone, but Telegram allowed | **Yes**, provided control plane and Mac connection are healthy |
| ChatGPT website blocked on controlled Mac, Pocket-T endpoint permitted | **Yes**; Mac doesn't need to open ChatGPT |
| OpenAI API blocked from the Mac | **Yes for cloud-orchestrated actions**; separately installed CLI vendors may still fail |
| Mac companion blocked/offline | **No**; bot can report state and receive a deferred user request, but not execute |
| OpenAI API temporarily unavailable | Deterministic status and configured safe workflows still work; AI actions unavailable |
| Telegram blocked on phone | **No**; use web/PWA/approved alternatives |
| Cloudflare shared backend unavailable | **No** unless separately deployed, independently reachable failover infrastructure is added |
| Company prohibits remote terminal control or egress | **No**; explicit authorization/network permission needed |

## Sequencing / acceptance

1. First ship shared cloud command/receipt API with the OpenAI orchestrator and Mac connection.
2. Add Telegram channel as a small Cloudflare Worker webhook integration **at the same time as the first usable cloud control slice**, not after remote desktop work.
3. Test identity-pairing, unauthorized users, duplicate callbacks/replayed updates, invalid session targets, disconnected Macs and blocked web app on the **phone**.
4. Test free text, voice-note transcription, project status, evidence-backed progress, approval and rejection with explicit audit receipts.
5. Run the fallback with the Mac's direct OpenAI domain access disabled **in a permitted test network**, while the Mac can reach the Pocket-T connection. Ensure no Mac-side request to OpenAI/Telegram is required.
6. Never market Telegram as a way around managed-device restrictions or security controls.

## Source references

- Telegram Bot API, webhook secret, inline keyboards, callback queries, file and voice message APIs: https://core.telegram.org/bots/api
- Telegram explanation of cloud chats vs E2EE Secret Chats: https://telegram.org/faq
- OpenAI audio transcription: https://developers.openai.com/api/docs/guides/transcription
- Cloudflare Workers request handlers and queues: https://developers.cloudflare.com/workers/runtime-apis/handlers/ and https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
