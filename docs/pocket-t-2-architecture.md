# Pocket-T 2 — Mobile Control Plane (Architecture Decision)

**Status:** Working architecture / implementation plan. The current `feat/workspace-v2-first-slice` branch contains a new responsive client shell. It **does not yet contain** the cloud OpenAI coordinator, existing-terminal acquisition adapters, or GUI-control capability described below. Do not label those as shipped.

## Product definition

Pocket-T is an **OpenAI-powered, mobile-first control plane for a user's machines, existing terminal sessions and AI agents**. It is not an SSH app with chat bubbles. The human should spend most time on their phone viewing outcomes, giving intentions by voice, reviewing proposed actions, approving operations and opening a true terminal or desktop view only as needed.

### Non-negotiable requirements

1. **Phone first, responsive web/PWA first**. Desktop browser is supported, but not the primary design target. Voice and touch must be first-class.
2. **OpenAI models are essential**, not an optional CLI plugin. Model inference and tool orchestration are cloud-owned, independent of whether `chatgpt.com` or `api.openai.com` can load on the controlled computer.
3. **Restricted-network support**. A controlled Mac may block ChatGPT and other AI sites. Its agent must not need to reach those domains. It connects only to a Pocket-T endpoint permitted by that network. If the policy/network blocks even that endpoint, the machine is **offline**; Pocket-T must not attempt to evade security policy, MDM, filtering or firewall controls.
4. **Pre-existing terminals**. Users see already-open sessions, not just terminals started under `pt`. Discovery must state each session's real read/control capabilities; UI must never imply full PTY attachment to arbitrary processes.
5. **Remote machine interaction**. Add explicit-consent screen/window streaming and pointer/keyboard controls, plus an OpenAI-directed local automation adapter. A browser alone cannot acquire macOS screen or Accessibility permissions.
6. **Persistent, auditable operation**. Machine identity, pairing, human approval, queue status, command outcome and user-visible failure states are required.
7. **Preserve backend investments**. Keep `pt-shim`, private tmux persistence and the existing ws-v3 streaming path for the lossless managed-terminal source; do not make a forked viewer the final interface.

## Three planes / four runtime pieces

```text
   iPhone / Safari / Installed Pocket-T PWA      Desktop browser
             | HTTPS / WebSocket / WebRTC
             v
   Cloudflare Worker -- authenticates user/device, validates commands
             |
             +---- OpenAI Responses API: intent, planning, tool selection,
             |     grounded summaries, image analysis, review
             |     (OpenAI API key is a Worker SECRET, never sent to Mac)
             |
             +---- GPT-Live / Realtime API: voice input and speech output
             |     (session bootstrapped by the trusted Worker)
             |
             +---- Durable Object: per-machine command/status relay
             |     D1: machine/project/task metadata
             |     R2: optional encrypted/retained screenshots and logs
             v
      authenticated outbound machine connection (only if allowed)
             |
     Native Mac companion (existing daemon + new OS adapters)
             |
             +-- pt-shim managed PTY: exact bidirectional bytes / tmux
             +-- other tmux panes: capture-pane / send-keys
             +-- Terminal.app, iTerm2: supported app automation APIs
             +-- VS Code / Ghostty / other: extension or explicit capability
             +-- ScreenCaptureKit: window/display stream (permissioned)
             +-- Accessibility / supported app automation: GUI actions
```

**Security boundary:** User input becomes an **intent**; OpenAI produces a typed plan/tool request, not arbitrary bytes to pipe blindly into a privileged Mac. The server policy engine and the Mac-local policy enforcement point both check the machine, target session, action, consent and risk level. Only then does an action execute. The model never gets to override that policy.

## Restricted machines: the exact distinction

There are three different restrictions that must never be conflated:

- **AI website blocked in the controlled Mac's browser**: fine. The OpenAI model lives in Cloudflare/OpenAI cloud. The Mac doesn't browse ChatGPT.
- **OpenAI API blocked from the controlled Mac**: also fine for Pocket-T's own cloud-orchestrated tasks, assuming a Pocket-T machine connection is allowed. A separately installed Claude/Codex CLI on the Mac may still be blocked when it tries to reach its own model API. Pocket-T does not magically fix that CLI's network access; route inference through an explicitly integrated, approved cloud agent workflow instead.
- **All outbound Pocket-T connections or remote-control capability blocked**: Pocket-T can't control that machine until an approved transport or approved local on-device integration exists. Never silently tunnel around enterprise controls.

No data from a managed machine is forwarded to OpenAI by default. Per-machine policy chooses whether prompts, terminal output, screenshots, or file snippets may be sent to the model; otherwise redact/deny/offload work to a permitted workspace. Display the data-access state in the UI.

## Discover existing terminals without falsely claiming complete attachment

The current `pt` shim only controls sessions it owns. Arbitrary already-running PTYs cannot all be retrospectively adopted into that model. Introduce a **SourceAdapter** contract:

```ts
type Capability = 'discover' | 'snapshot' | 'stream' | 'sendLine'
  | 'sendKeys' | 'resize' | 'signal' | 'history' | 'guiView';

interface TerminalSourceAdapter {
  source: 'managed-pt' | 'tmux' | 'terminal-app' | 'iterm2'
        | 'vscode' | 'ghostty' | 'wezterm' | 'other';
  discover(): Promise<DiscoveredTerminal[]>;
  capabilities(sessionId: string): Capability[];
  capture?(sessionId: string): Promise<ScreenSnapshot>;
  sendLine?(sessionId: string, text: string): Promise<OperationReceipt>;
}
```

Source order:

| Source | Discover | View current output | Control | Implementation |
| --- | --- | --- | --- | --- |
| Managed `pt` + private tmux | yes | lossless live PTY + snapshot | full text/keys/resize/stop | existing Rust shim |
| Unmanaged tmux (other sessions) | yes | `capture-pane` snapshots; optionally pipe pane | `send-keys`, target-specific | tmux pane adapter |
| Existing Terminal.app tabs | if Apple Events allowed | app-visible scrollback snapshot; not full PTY history | app scripting line-level; GUI fallback | macOS automation / Accessibility |
| Existing iTerm2 tabs | if app scripting permitted | script-visible buffer, plus API streaming where supported | app API; GUI fallback | iTerm2 Python API or scripting |
| VS Code integrated terminal | via extension/cooperation | extension or UI capture | extension or UI controls | explicit VS Code extension |
| Ghostty / WezTerm / unknown | depends on available app IPC | supported app API or ScreenCaptureKit | supported app API or GUI | per-app adapter |

For every session show the **provenance and capabilities**. Example: `Terminal.app · existing session · snapshot + send line` versus `pt · live terminal · full input`.

**Never kill/restart or reparent an existing process to make it discoverable.** For first implementation, ship inventory read-only, then add per-adapter writes after tests on a real Mac.

## What the mobile UI should be

- **Home:** machine cards, whether each is online, projects/current work, queued tasks, and prominent "Needs your attention".
- **Work view:** status-first feed showing work completed, current step, blockers, tool receipts and proof (diff, test output, screenshot). No terminal text by default.
- **Voice:** prominent microphone; GPT-Live/Reatime for conversation and tool delegation. Explicit confirmation for high-impact actions. Browser speech recognition can temporarily produce an editable draft, but must not be confused with OpenAI-based conversational voice.
- **Session drawer:** lists all discovered terminals across machines, with `read-only`, `send line`, `full PTY`, `remote screen` capability labels.
- **Command palette:** one-tap reversible/low-risk operations, project-specific templates, keyboard optionally hidden.
- **Review centre:** show diffs, test reports, screenshots and pending approvals as structured UI, with provenance and action receipt.
- **Desktop:** optional live window/screen view with pan/zoom/touch/keyboard and clear `Viewing` vs `Controlling` state.

No fake "working" progress, no inferred terminal status from an agent's prose, no command labels that map unexpectedly to destructive shell actions.

## Control protocol and OpenAI workflow

Cloud tool interface (versioned and schema-validated):

- `list_machines`, `list_sessions`, `get_session_snapshot`, `get_process_status`
- `read_project_metadata`, `read_diff`, `run_tests` (commands only from approved project/task presets)
- `send_agent_prompt`, `send_terminal_line`, `send_terminal_keys` (capability checks)
- `request_screen_share`, `capture_screen`, `operate_ui` (explicit local opt-in)
- `approve_pending`, `deny_pending`, `cancel_task`

Flow: user intent -> OpenAI plan/function call -> server validates identity and allowed action -> mac companion validates scope and local permissions -> Mac executes or declines -> signed operation receipt -> model can summarise grounded outcome -> phone displays evidence. Terminal output/screen captures only enter OpenAI when data policy explicitly permits it.

Use an action ID, idempotency key, target machine/session, TTL, risk classification, authorization context, and explicit receipt for every mutating command. Queue non-mutating status work when offline if appropriate; never silently queue destructive commands to execute later.

For real-time voice use OpenAI's documented WebRTC client route with a server-owned session handshake; never ship the OpenAI API key to the browser.

## Security / identity requirements

- Cloudflare Access or an equivalent passkey identity gate; validate signed identity assertions in the Worker, not only the presence of headers.
- Pair each Mac locally using a short-lived code, rotate device credentials, support device revocation and per-device policy.
- Current `?t=` URL-borne terminal token is a legacy bootstrap mechanism; don't promote it as the production credential model.
- Separately authorize terminal inputs, screenshots, pointer/keyboard GUI controls and OS automation. Never auto-grant Accessibility or Screen Recording.
- Annotate Mac streams as `local`, `redacted cloud model`, or `cloud model allowed`. Don't expose an enterprise screenshot or secrets to OpenAI by default.
- Avoid persistent raw shell transcripts unless opt-in. Keep tamper-evident action metadata without default secret-bearing payloads.
- Never claim the cloud relay is end-to-end encrypted if the server can read its contents; optionally add browser↔Mac application-layer encryption for raw screen/PTY streams, with deliberately controlled model disclosure.

## Delivery order / acceptance tests

**Slice A — Mobile experience (branch in progress)**
- Responsive overview, session activity, one-tap prompts, optional terminal fallback.
- Uses the current daemon. This is a UX foundation, **not Pocket-T 2.0 delivered**.
- Verify on iPhone Safari, desktop, and with network disconnect/reconnect; no duplicate commands.

**Slice B — Existing-session inventory**
- Existing tmux panes + existing Terminal.app + iTerm2 tabs appear without restarting them.
- A discovered but uncontrollable session is visibly read-only; no fake controls.
- Stable identity across window/tab reorder and reconnect; no accidental cross-target commands.

**Slice C — OpenAI/cloud orchestration (essential)**
- Cloudflare Worker + per-machine Durable Object + OpenAI Responses function tools.
- Mac has no dependency on reaching OpenAI domains. Run against a controlled test where OpenAI/ChatGPT are unavailable from the Mac but the approved Pocket-T endpoint is reachable.
- Model output must not directly execute; permission and receipt gates mandatory.

**Slice D — Voice and structured evidence**
- GPT-Live or Realtime via WebRTC, clear recording/mute state, interruption support.
- Diff/test/screenshot cards; actions only execute against selected target/session.

**Slice E — Remote screen + GUI control**
- macOS companion uses ScreenCaptureKit for an explicitly selected display/window, and Accessibility or an approved OS app API for permitted GUI input.
- Handle permission-denied/locked-screen/MDM-blocked states as real UI states.
- Authenticate the session, require an active user-visible "Control" mode, and enable one-tap revocation.

**Slice F — Multi-device + production hardening**
- Device identity and project grouping, audit traces, credential rotation, scoped sharing, network-policy modes, E2E tests and release/rollback.

## Current limitations in the older code

- Managed terminals require the `pt` shell proxy; existing arbitrary windows are not in that registry.
- Claude has a working transcript adapter; Codex and other agents often only show raw terminal/badge.
- Browser dictation is not OpenAI GPT-Live voice.
- Existing hook approvals have documented integration/liveness gaps.
- Cloudflare Quick Tunnel's ephemeral URL is not a production identity/pairing model.
- Remote desktop screen streaming is not implemented.

## Official implementation references

- OpenAI Responses/function calling: https://developers.openai.com/api/reference/responses/overview
- OpenAI Live / WebRTC: https://developers.openai.com/api/docs/guides/voice-webrtc
- Cloudflare Durable Objects websockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Access JWT validation: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- Apple ScreenCaptureKit: https://developer.apple.com/documentation/screencapturekit
- Apple AXUIElement Accessibility API: https://developer.apple.com/documentation/applicationservices/axuielement_h

## Secondary Telegram control channel (fallback)

A Telegram bot is an **approved secondary, low-bandwidth UI** for when the primary Pocket-T site cannot load on the phone but Telegram is available. It uses the **same Cloudflare/OpenAI orchestration, identity, machine transport, command validation and receipts**, not a separate privileged bot or agent. Ordinary chat/voice/inline buttons must work without opening a Telegram Mini App; the Mini App is optional and may share the same website-blocking problem.

The controlled Mac does **not** need to connect to Telegram or directly to OpenAI. It still needs an explicitly permitted Pocket-T machine connection. Telegram is not an alternative transport out of a fully disconnected or security-blocked Mac. Telegram bot chats are cloud chats rather than E2EE Secret Chats; defaults must use bounded, redacted summaries and step-up approval for impactful actions.

**Full implementation contract:** [Telegram fallback design](telegram-fallback.md). This document is a design decision only; the bot is not implemented, connected or deployed in this PR.

## Files, apps, browsers and Keychain-backed values

The same Pocket-T account and mobile web app include separate **Files**, **Applications**, **Desktop** and **Vault & Values** interfaces, gated by the same machine identity and local policy enforcement. Exact Apple/Chrome capabilities, Apple TCC and enterprise-policy boundaries, explicit folder-root configuration, and the credential-design trust model are documented in [Mac workspaces: files, apps, browsers, credentials](mac-workspaces-v2.md). The current first slice exposes only opt-in read-only file metadata browsing and locally-allowlisted app launch; no GUI control or credential entry is shipped yet.

## Optional SSH, Tailscale and browser-VNC fallback

**SSH, Tailscale Serve and noVNC are a supplementary transport and desktop-control strategy**, not substitutes for the OpenAI/Cloudflare command policy plane. Ordinary macOS Remote Login can provide SSH/SFTP on a permitted private Tailscale network; Tailscale Serve can privately expose the current Pocket-T browser UI; Apple's Screen Sharing plus noVNC/websockify is a promising *unvalidated* HTML5 desktop-control fallback. None of these can adopt an arbitrary previously-running Terminal.app PTY, unlock macOS, or override managed-device policy. See [SSH/Tailscale/noVNC design and verification matrix](ssh-tailscale-fallback.md). This integration is **not implemented in the current draft PR**.
