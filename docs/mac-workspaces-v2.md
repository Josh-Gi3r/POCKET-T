# Pocket-T 2 — Mac Files, Apps, Browsers and Credentials

**Decision / status (2026-11-01):** Build a single mobile-first Pocket-T app with dedicated `Files`, `Apps`, `Desktop` and `Vault & Values` workspaces alongside AI/Terminals. These are **not** separate products or login systems. Do not imply that a blocked website, protected OS action, Mac login screen or device security policy can be bypassed.

## Truthful capability map

| User intent | What macOS can support | Permission / integration | Boundary |
| --- | --- | --- | --- |
| Browse folder trees | Yes, subject to POSIX/TCC permissions | Scoped local Mac filesystem adapter | No automatic Full Disk Access; root scopes chosen locally |
| Read/preview files | Yes, if Mac user's process has permission | Safe path resolver + typed previews; user-initiated request | Not implemented in first slice; no files forwarded to OpenAI by default |
| Edit, move, rename, upload, download | Yes if target writable and network connection allowed | Transactional operations, conflict checks, confirmation, backups | Not implemented yet; must guard accidental deletion/overwrites |
| Open and focus installed applications | Yes, under active user session | `NSWorkspace.openApplication` or approved `/usr/bin/open -b` | Some launches blocked by policy, locked session or missing app |
| Enumerate open windows | Often, if native permissions allow | `NSWorkspace`, `CGWindowList`, `ScreenCaptureKit` | Privileged windows, off-screen or locked states may not be exposed |
| View window / screen | Yes with appropriate user grant | ScreenCaptureKit + screen capture selection and permission | Cannot silently acquire Screen Recording; MDM restrictions apply |
| Click/type/scroll in UI | Yes for accessible permitted UI | Accessibility AXUIElement and/or supported app automation | Must check `AXIsProcessTrustedWithOptions`; not guaranteed for protected fields/windows |
| Control Chrome/Chromium tabs | Yes for sites/tabs permitted to the extension | Permissioned Chrome MV3 extension (`activeTab`/`scripting`) or debugger API | Enterprise policy can prevent extension install, host access or debugger; cannot bypass site restrictions |
| Control Safari tabs | Supported cases through Safari Web Extension / AppleScript / GUI | Browser-specific integration and grants | Not a guarantee on all managed Safari windows |
| Use passwords on an approved website/app | Sometimes, with pre-enrolled secrets and approved target | Locally held Keychain secret + narrowly scoped credential action | Protected dialogs, OS lock and 2FA may require user presence |
| Supply password entered from Pocket-T iPhone | Technically possible when Mac app is running and reachable | End-to-end encrypted browser-to-companion secret envelope; Keychain or one-time use | **Do not** send secrets through current plain ws-v3 relay; not implemented yet |
| Enter ordinary non-secret values | Yes into controlled input targets | Typed action + capability/target check, or existing PTY input | Restricted/protected fields still blocked |
| Auto-use stored credentials without user present | Only for specific pre-authorised targets if keychain policy permits | App-created Keychain items with permitted non-interactive read + local scope | Items protected by UserPresence/Touch ID cannot be silently unlocked remotely |
| Sign into locked Mac / disable a corporate website block | Not a general supported remote-control feature | N/A | Do not attempt to bypass screen lock, system integrity, MDM, TCC or network policy |

## Why a signed Mac companion is important

Existing `pt` is a Rust PTY shim and `pt-registry` is a Node daemon. Keep both for lossless terminal sessions. Add a **native signed, user-session Mac companion** for macOS UI, Keychain, ScreenCaptureKit, accessibility permission checks and explicit folder selection. A Node process may perform basic user-permitted file operations and launch allowlisted apps, but shouldn't impersonate a native app for TCC, Keychain entitlements or Screen Recording.

Prefer `NSOpenPanel`-selected folders and security-scoped bookmarks where applicable over asking everyone for Full Disk Access. The UI must show what paths the user allowed and how to revoke access.

## Workspace structure

**Files** — visual iPhone-first directory breadcrumbs, search, file-type preview cards, folder moves, context menu and selective project sharing with OpenAI. Projects and roots appear in the same product account. No raw filesystem roots accepted from browser input. Each operation carries target, permission scope and a receipt.

**Apps** — running apps, allowed launches, user-visible window selections, supported controls. App launch and GUI control are separate capabilities.

**Browsers** — list and act on supported tabs, navigate, click, fill nonsecret values, collect screenshots or DOM, create structured actions; use the browser's extension/API when permitted, macOS Accessibility UI fallback when permitted. Browser privacy, password-store policies and cross-origin protections remain in force. Pocket-T cannot restore access to a company-blocked site simply by opening it.

**Desktop** — ScreenCaptureKit stream selected display/window, direct touch/pointer, distinct "view only" vs "control" states, remote-control indicator, explicit stop/revoke and time-bound consent. WebRTC optional stream; policy-selected lower-bandwidth stills when adequate.

**Vault & Values** — separate structured objects:
- **Nonsecret value:** string/date/number templates (e.g. project path, email alias, standard form text); can optionally sync through Cloudflare if allowed.
- **Secret:** password/API token, stored in **macOS Keychain** (or explicitly approved managed vault). Show only label, account/target and policy in UI, never plaintext by default.
- **One-time secret:** user types on Pocket-T iPhone; browser encrypts directly to the **paired Mac companion public key**, with associated data binding account, destination target and operation nonce; MAC verifies recipient and decrypts in memory; secret is not persisted unless user explicitly chooses "save to Keychain".
- **Use policy:** particular application/URL origin, account label, requested action, time-to-live, optional one-time confirmation. No generic `fill password in whatever window currently has focus`.
- **User presence:** keychain items protected by user-presence / Touch ID may require approval on that Mac. Phone biometric verification is not an automatic replacement for Mac local Keychain/OS user-presence checks.
- **Never:** insert secrets into shell history, argv, environment, transcripts, OpenAI prompts, Telegram messages, screenshots, logs or audit payloads. Redact password entry fields in any screen capture and apply strict data classification.

## Secret acquisition lifecycle

1. Pair phone to a specific Mac (display and verify fingerprint/QR locally). Pairing is authenticated and short-lived. Key exchange tied to the device identity, not simply the current URL bearer token.
2. User requests **Use credential** for an explicitly selected browser origin, app, or CLI credential helper. Model can request a scoped credential operation but cannot ask for the plaintext.
3. Gateway sends an opaque operation intent to Mac and phone. If allowed, phone's protected form encrypts a one-use secret to the paired Mac; cloud relay routes ciphertext only.
4. Local Mac companion validates exact target, expires request after a short TTL and checks consent/user-presence policy. When possible it invokes an approved extension/app API to fill that known field or supplies a token via a purpose-built `askpass` / credential-helper interface. Existing arbitrary shell prompts do **not** gain a magic password-injection channel.
5. Result is `used`, `rejected` or `not supported` with a nonsecret receipt. Secrets are not echoed back or added to AI context.

Never show a working-looking password entry form in the product until E2E protection, device pairing and the local delivery adapter have been implemented and audited.

## When OpenAI is allowed to act

OpenAI plans tasks and explains what happened using real receipts from the Mac. It can find a file in an allowed root, propose edit/summaries or choose an app to launch. A policy engine approves typed tool calls; the Mac-local policy enforcement point independently checks target/capability. For machine data marked "local only", OpenAI receives metadata or an explicit denial, never the file contents, screenshots or credentials. No corporate content should be sent to OpenAI merely because a terminal happens to be accessible.

## First implemented slice (current draft PR)

- `packages/daemon/src/pt-registry/files.ts`: `POCKET_T_FILE_ROOTS='["~/Documents","~/Projects"]'`; opt-in, **read-only** metadata inventory, symlink/traversal protections and no file-content retrieval.
- `packages/daemon/src/pt-registry/apps.ts`: `POCKET_T_ALLOWED_APPS='[{"name":"Safari","bundleId":"com.apple.Safari"}]'`; explicit allowlist and `/usr/bin/open -b` launch only. A successful return means macOS accepted the launch request, **not** that the app loaded a site or that controls are granted.
- `packages/web-client/src/components/FilesWorkspace.svelte` and `AppsWorkspace.svelte`: mobile-first views backed by those current daemon capabilities.
- **Still not implemented:** native signed companion, content previews and file editing, browser control, GUI input, real remote desktop, Mac Keychain vault, browser↔Mac E2E secret delivery, security permission diagnostics.

No changes to existing terminal sessions or filesystem contents. Existing managed terminals keep their own full PTY behavior.

## Acceptance / restrictions testing

- File roots are empty until the Mac owner configures them. Attempting `../`, absolute paths, symlink escape, hidden files and unavailable protected directories cannot exfiltrate file contents.
- A Mac may deny Desktop/Documents/Downloads even if the process can see other folders; UI reports actual error, not synthetic "permission granted".
- Approving Safari launch does not approve Chrome or any other bundle ID. Missing app produces an explicit error.
- On a managed Mac test that refuses Screen Recording, Accessibility or Chrome extension install, UI must show **blocked by device policy** or **permission required**; no bypass or hidden retry loop.
- On a permitted Mac and approved browser site, define tests for launch, focus, navigate, click and fill a nonsecret test form first. Secret flows require independent threat-model/security tests before real secrets are accepted.
- Ensure a blocked ChatGPT site on the Mac does not affect OpenAI cloud orchestration **if** the Pocket-T connector is permitted. A Mac with no permitted machine transport is offline and uncontrollable.

## Apple / browser source references

- https://developer.apple.com/documentation/screencapturekit
- https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions
- https://developer.apple.com/documentation/appkit/nsworkspace
- https://developer.apple.com/documentation/security/adding-a-password-to-the-keychain
- https://developer.apple.com/documentation/security/secaccesscontrolcreateflags/userpresence
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developer.chrome.com/docs/extensions/reference/api/debugger
