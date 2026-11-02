# Pocket Studio — Design System v1

**Status:** Implemented design direction in `feat/pocket-studio-2028-ux`, stacked on terminal-first PR #6. The web UI is available only on this development branch until tested on a real iPhone, Mac, network and approved session. **CI and fixture screenshots are design evidence, not a claim of final 2028 readiness.**

## The product principle

> **Terminal power, without terminal aesthetics.**

Pocket-T is a remote machine workspace. Full, raw PTY control is an indispensable capability, but the **app itself is a premium visual workspace** with session cards, contextual actions, file surfaces, application access and a direct terminal workroom. The user must never have to invoke an AI model to perform basic machine operations. AI providers are optional extensions.

The visual language is *iridescent minimalism*: luminous paper-white canvases, soft depth, a single violet/indigo accent, carefully contained glass layers, understated geometric iconography and responsive motion. This is not a retro CLI theme, fake macOS terminal or generic AI chatbot.

## Audited design references (November 2026)

- Apple's **Liquid Glass** guidance emphasises hierarchy, adaptable materials, restrained colour and device-appropriate navigation: https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass
- Apple's WWDC25 **Meet Liquid Glass** video explains dynamic materials and adapting navigation/controls: https://developer.apple.com/videos/play/wwdc2025/219/
- Google Material 3 Expressive prioritises meaningful shape, typography, and spring-driven feedback: https://developer.android.com/design/ui/wear/guides/get-started/levels-expression
- Figma's 2026 design review documents depth, animation, customisation and accessible modes: https://www.figma.com/resource-library/web-design-trends/
- Motion's Svelte documentation describes modern layout/gesture/view animation if built-in Svelte transitions prove insufficient: https://motion.dev/docs/svelte
- MDN View Transitions API: https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- WCAG 2.2 reference: https://www.w3.org/TR/WCAG22/

## Current implementation

### Visual language
- Main UI: #f8f8fc off-white, white card surfaces, ink #292742 and violet #7862df.
- Hero: indigo-lavender gradient with an **animated prismatic orb**; no green-on-black marketing ornament.
- Contextual panes: rounded surfaces, restrained border and elevation; a translucent mobile dock whose placement stays centered under animation.
- Current PWA icon: dependency-free generated faceted prism, replacing the old `>_` terminal-prompt icon.
- The actual terminal remains dark graphite for reading ANSI output; **its surrounding workspace is light**.

### Mobile-first interaction rules
- The workbench is the default entry. One tap **Continue working** attaches to the real existing selected terminal; the secondary Live sessions view contains the full PTY and shortcut controls.
- Bottom floating navigation: Overview, Sessions, Files, Apps, Machine. *Do not* steal vertical space from the live terminal; hide floating navigation while in the live session.
- All primary tap targets should be at least 44×44pt equivalent; small decorative text cannot be a required actionable control.
- Terminal composer uses at least 16px on iPhone Safari to avoid unexpected focus zoom.
- App overlay/palette and session sheet support touch; keyboard shortcut **Cmd+K** (or Ctrl+K outside terminal) opens quick actions. **Ctrl+K must remain available to the raw PTY**.
- Session and machine status are derived from the actual daemon. Never fake "running", "done", tests or approvals.
- Preserve unsubmitted drafts across disconnect; never automatically execute stale queued input.
- All modals provide an obvious close control; command palette also supports Escape and keyboard navigation.
- Currently **not implemented**: full swipe gestures, pointer-hover previews, haptics, draggable split panels, selectable light/dark UI themes. Don't advertise these as shipped.

### Motion specification
| Trigger | Motion | Purpose |
| --- | --- | --- |
| Hover card | Lift 2–3px, soften shadow | Indicates selectability on pointer devices |
| Tap / press | Scale 0.97–0.99 briefly | Tactile feedback |
| Page enter | ~185–300ms opacity/offset easing | Maintains spatial continuity |
| Mobile session sheet | ~380ms cubic ease, from below | Reveals layered navigation |
| Command palette | ~250ms scale/offset + backdrop blur | Keeps user context visible |
| Orb | Very gentle 8s transform, no permanent canvas/WebGL repaint | Personality without attention theft |
| Reduced Motion | Disable transitions/animations | Respect OS preference |

General easing: `cubic-bezier(.22,1,.36,1)`. Prefer CSS transforms/opacity over layout thrashing. Maintain focus and usable state after route changes. Hover-only interactions are never required for mobile.

### Capability/trust rules
- New terminal / join existing tmux: unchanged true PTY protocol and live Mac processes.
- Files: scoped, read-only directory listing where locally permitted; no content transfer in this slice.
- Apps: local allowlisted launches only.
- Vault: explanatory preview only; **no password fields or credential storage**.
- AI: optional; no account/model needed for core terminal and file/app actions.
- No product UI may imply that previously unmanaged Terminal.app/iTerm2 processes are universally joinable.

## Real-world acceptance plan

**Screenshot baseline:** GitHub Actions builds the exact Svelte frontend and runs headless Chromium with simulated WebSocket session events for iPhone (393×852 CSS pixels) and desktop (1440×900). These are reproducible *UI* screenshots, not live-device screenshots.

Release gates:
1. **Safari on a real iPhone:** keyboard appears without hiding the active terminal prompt; bottom nav is entirely visible; screen rotation and safe areas work; user can resume a running tmux job and interact with it by touch.
2. **Scannability:** show the selected Mac and first live session within the initial mobile scroll region, without losing the emotional visual quality.
3. **Visual polish:** no clipped floating dock, overlapping hero ornaments, odd focus squares, tiny interaction targets, jarring dark/light switches, or debug prompt styling on non-terminal screens.
4. **Motion/accessibility:** keyboard navigation, focus visibility, reduced motion, screen-reader names, large text, and safe interaction while network reconnects.
5. **Latency:** app opens with a meaningful frame quickly on weak mobile networks; terminal renderer loads lazily; animations run smoothly on a low-power phone.
6. **Production identity/pairing:** don't release the current legacy bearer-URL as the final production trust model; validate private-network/session controls before rollout.

## Source of truth in repo
- `packages/web-client/src/app.css` — semantic tokens
- `packages/web-client/src/App.svelte` — adaptive workspaces, mobile dock, command palette, transition shell
- `packages/web-client/src/components/WorkspaceHome.svelte` — primary visual workbench
- `packages/web-client/src/components/TerminalWorkspace.svelte` — direct live PTY workroom
- `packages/web-client/src/components/Icon.svelte` — shared iconography
- `packages/web-client/src/components/FilesWorkspace.svelte` / `AppsWorkspace.svelte` / `VaultWorkspace.svelte` — related tools
- `packages/web-client/scripts/gen-icons.mjs` — prism PWA icon generator
- `packages/web-client/scripts/capture-preview.cjs` — test fixture capture
