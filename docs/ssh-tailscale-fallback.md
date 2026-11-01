# Pocket-T 2 — Transport Fall-back: SSH, Tailscale, and noVNC

**Decision date:** 2026-11-01

**Status:** Evaluated implementation plan, **not deployed**. These are *opt-in* transport and protocol adapters within Pocket-T, not additional products. No changes to device networking, macOS Remote Login or Screen Sharing are made by this document. No Tailscale, SSH or VNC transport has been integrated into the draft branch yet.

## Recommendation

Maintain one OpenAI-driven, policy-enforced Pocket-T control plane and multiple verified connectivity paths. Prioritize **ordinary macOS SSH/SFTP over Tailscale** as a reliable, private fallback on a personally controlled Mac, **Tailscale Serve** for direct private access to Pocket-T's web UI, and **noVNC + websockify + macOS Screen Sharing** as the *first desktop-control proof of concept*. Do not write a new VNC stack before testing the existing, touch-capable open-source browser client.

OpenAI inference remains in the cloud, not on the restricted Mac. The Mac must connect to an authorized command transport for cloud-driven work; merely connecting a phone to the Mac over Tailscale does **not** make Cloudflare Workers part of the tailnet.

## Separate transport from capability

| Layer | Primary | Fallback | Does NOT solve |
|---|---|---|---|
| OpenAI intelligence | Cloudflare-controlled OpenAI API calls | Approved recovery provider/location if designed later | Network blocked for machine-local CLI models |
| Machine ↔ cloud command bus | Mac outbound Pocket-T WebSocket/HTTPS to Cloudflare | Explicitly approved alternative local connector/bastion | Mac with all egress/remote-control blocked |
| Browser ↔ Pocket-T Mac | Current Pocket-T HTTPS/Cloudflare path | Tailscale Serve or LAN, where user and Mac are on same permitted network | Browser blocked plus VPN installation prohibited |
| Shell execution | Current `pt`+tmux for lossless managed sessions | Ordinary macOS SSH login over tailnet, or managed SSH via explicitly approved gateway | Capturing another app's pre-existing, uninstrumented PTY |
| Files | Mac-local, scoped file adapter | SFTP/SCP over SSH using Mac account rights | TCC/MDM/OS file access denial |
| Existing terminal inventory | Mac adapters for tmux, Terminal.app, iTerm2 | tmux attach for panes *already in tmux* | Taking ownership of an arbitrary Terminal.app pane via SSH |
| Remote GUI | Mac companion ScreenCaptureKit/Accessibility (future) | Apple Screen Sharing (VNC) + noVNC/websockify (POC) | Protected/locked interfaces or missing screen-sharing approval |
| Lightweight emergency controls | Pocket-T mobile web | Telegram Bot API calling same Cloudflare command bus | Mac disconnected from control plane |

### Non-obvious macOS limitation

**Tailscale** as a network is different from the product **Tailscale SSH**. On macOS, the latter can be *hosted* only using the open-source `tailscale` + `tailscaled` CLI variant; the normal GUI/App Store variants are not Tailscale SSH servers. Use Apple's built-in **Remote Login / standard sshd** over the tailnet instead; this preserves ordinary SSH keys and is simpler. This recommendation is optional and requires the owner to enable Remote Login for selected users. Avoid exposing port 22 directly to the Internet.

## How the private fallback would work

```text
PERSONAL MAC (network/client install allowed)
  ├─ Pocket-T daemon on localhost:7700 + existing pt-shim/tmux
  ├─ Native sshd if user explicitly enables Remote Login
  │     └─ SSH session / SFTP client (separate from existing GUI panes)
  ├─ Screen Sharing server if user explicitly enables it
  │     └─ noVNC browser client ⇄ websockify ⇄ VNC (localhost:5900)
  └─ Tailscale installed/enrolled on Mac
          │ authenticated tailnet, device access controls
          ▼
IPHONE with Tailscale connected
  ├─ Safari/installed web app → Tailscale Serve → localhost:7700
  └─ noVNC in Pocket-T UI → protected WebSocket path → desktop

CLOUD (separate, not magically a tailnet member)
  ├─ Pocket-T Cloudflare Worker + OpenAI API
  ├─ Policy/identity/operation receipts and Telegram webhook
  └─ Mac outbound Pocket-T command bus, when permitted
```

The iPhone needs Tailscale installed and enabled to use the tailnet-only private endpoints from Safari. A mobile browser itself cannot talk directly to raw SSH, SFTP or VNC; it needs a protocol-specific gateway/client. Tailscale Serve exposes a **private web service**, while Tailscale Funnel creates an **Internet-reachable service**; use Serve only for the protected fallback.

## Test first, then integrate

### SSH/SFTP proof of concept

1. On a **personally administered Mac**, enable **System Settings → General → Sharing → Remote Login → Only these users** for an authorized account. Use SSH keys and known-host verification; never store password input as argv or shell history. Never request remote Full Disk Access automatically.
2. Install/authorize Tailscale on the Mac and iPhone; restrict tailnet device/port permissions, verify the private route, then try a standard SSH connection from an authorized client.
3. Verify `pwd`, `uname`, `git status`, read/write only approved test folders, and SFTP upload/download. For Pocket-T, expose typed commands/receipts rather than unrestricted root-equivalent shell execution.
4. If using tmux, verify `tmux list-sessions` and `tmux attach -t <session>` work for existing tmux sessions. Opening an SSH session does not take over a GUI Terminal.app window's live PTY.

### Direct mobile web proof of concept

With the Pocket-T daemon actually listening locally on port 7700, validate a tailnet-only HTTPS proxy using the current Tailscale Serve syntax, e.g. `tailscale serve 7700` (review `tailscale serve --help` for the installed version). Confirm websocket upgrades, token/session authentication, PWA service worker scope and iOS reconnection. Do not assume the existing QR code automatically generates a correct tailnet URL. Never use Funnel as a shortcut.

### Browser desktop proof of concept

1. On a permitted **test Mac**, enable Apple **Screen Sharing** for selected users and, if necessary for a conventional VNC viewer, enable the explicit VNC-viewer password mode. Screen Sharing and Remote Management are alternative configurations; do not enable both simultaneously.
2. Stand up **websockify** bound to loopback, forwarding browser WebSockets to the local Screen Sharing VNC service. Integrate the open-source **noVNC** client into Pocket-T's Desktop tab. It supports mobile browser touch gestures, scaling, clipping and clipboard; actual Apple VNC authentication and permission behavior need to be tested.
3. Route the noVNC WebSocket endpoint over an authenticated, permitted private path (tailnet, or a separately protected Cloudflare endpoint). Do **not** publicly expose raw VNC or websockify. Treat desktop-control sessions as high-risk, time-limited capabilities with an immediate Stop/Disconnect control and no AI-visible screen by default.
4. Compare responsiveness/bandwidth/iPhone touch controls with ScreenCaptureKit and choose **VNC/noVNC** only if quality and security actually pass; do not assume a native streaming system is required from day one.

### Network-policy matrix

| Controlled device circumstance | Tailscale / SSH / noVNC result |
|---|---|
| Personal Mac, Tailscale and Remote Login permitted | Viable, testable fallback |
| Tailscale blocked but approved HTTPS to Pocket-T exists | Use outbound Cloudflare Mac companion; SSH over Tailscale unavailable |
| Browser ChatGPT site blocked on Mac but Pocket-T HTTPS permitted | OpenAI cloud orchestration continues; any separately installed CLI may still fail |
| VPN forbidden or device cannot run Tailscale | Do not install/force a VPN; use authorized HTTPS path if available |
| Remote Login disabled by managed policy | SSH unavailable; no alternate unauthorized activation |
| Screen Sharing / Accessibility disabled | GUI control unavailable, even if SSH command execution works |
| All remote connectivity disallowed / machine off | Offline; bot/web UI can show cached non-sensitive status but no live operations |

Tailscale can relay traffic via DERP when direct UDP can't be established, but does not guarantee connectivity: mandatory coordination, endpoint and device policies still apply. Never mistake "works on port 443" for authorization.

## Integrating with the existing code

**Do not discard** `packages/pt-shim` or the `pt-registry` managed PTYs. Add a capability-aware routing abstraction to the current session/machine catalog:

```ts
type SessionTransport = 'managed-pty' | 'ordinary-ssh' | 'tmux-adapter'
  | 'app-snapshot' | 'vnc-desktop';

type Connectivity = 'cloudflare-control-plane' | 'tailnet' | 'local-lan';

interface SessionReachability {
  sessionId: string;
  source: SessionTransport;
  reachableVia: Connectivity[];
  canRead: boolean;
  canSendLine: boolean;
  canSendKeys: boolean;
  hasLiveStream: boolean;
  requiresLocalApproval: boolean;
}
```

The system chooses **only** among locally enabled, verified, identity-authorized paths. Loss of a connection must never silently replay a non-idempotent command on a different path. Store operation IDs, target identity, risk/permissions and actual receipts separately from the network transport. Never send a saved credential to OpenAI/Telegram or automatically inject it into SSH command text. Follow `mac-workspaces-v2.md` for Keychain/secret-delivery design.

## Sources (checked 2026-11-01)

- Apple Remote Login: https://support.apple.com/en-sg/guide/mac-help/mchlp1066/27/mac/27
- Apple Screen Sharing: https://support.apple.com/en-sg/guide/mac-help/mh11848/mac
- Tailscale macOS variants: https://tailscale.com/docs/concepts/macos-variants
- Tailscale SSH server limitation: https://tailscale.com/docs/features/tailscale-ssh
- Tailscale Serve (tailnet-only): https://tailscale.com/docs/features/tailscale-serve
- Tailscale network connectivity/relay: https://tailscale.com/docs/reference/connection-types
- noVNC browser and WebSocket proxy: https://github.com/novnc/noVNC
