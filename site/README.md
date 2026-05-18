# pocket-t marketing site

Single self-contained `index.html`. Design system adapted from Josh's
`sera-agents` landing page (`~/Desktop/sera-agents/index.html`): same
structure and polish (sticky glass nav + mobile menu, hero status pill,
marquee, bento cards, tabbed install, accordion, grain + glow), but
pocket-t's own words and an indigo→violet accent instead of sera's mint.

Sections: hero → marquee → **the difference** (bot vs pocket-t, the core
pitch) → how it works (3 steps) → works-with grid → bento features →
tabbed install (hosted / self-host) → FAQ → CTA → footer.

Stack: Tailwind via CDN + Google Fonts (Inter / JetBrains Mono). No build
step. Domain is `pocket-t.ai`; GitHub is `Josh-Gi3r/pocket-t`.

SEO / agent-compatibility keywords are front and center: Claude Code
(Claude CLI), Codex, Aider, Gemini CLI, OpenClaw, Hermes, NanoClaw,
Claude Desktop, Cursor, MCP / Model Context Protocol.

## Deploy

- **Vercel:** `vercel deploy --prod` here (uses `vercel.json`).
- **GitHub Pages:** point Pages at `/site` or push to `gh-pages`.
- **Anywhere:** one HTML file — any static host / S3 / CDN.

Local preview: `python3 -m http.server 8080` then open http://localhost:8080
