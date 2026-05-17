# pocket-t marketing site

Single self-contained `index.html`. Design system adapted from Josh's
`sera-agents` landing page (`~/Desktop/sera-agents/index.html`): same
structure and polish (sticky glass nav + mobile menu, hero status pill,
marquee, "the problem" two-col, bento cards, hosts grid, tabbed install,
accordion, grain + glow), but pocket-t's own words, terminal/agent-
supervision industry, and an indigo→violet accent instead of sera's mint.

Stack: Tailwind via CDN + Google Fonts (Inter / JetBrains Mono) — exactly
like the sera-agents reference. No build step.

SEO / agent-compatibility keywords are front and center: Claude Code
(Claude CLI), Codex, Aider, Gemini CLI, OpenClaw, Hermes, NanoClaw,
Claude Desktop, Cursor, OpenAI Agents SDK, MCP / Model Context Protocol.

## Deploy

- **Vercel:** `vercel deploy --prod` here (uses `vercel.json`).
- **GitHub Pages:** point Pages at `/site` or push to `gh-pages`.
- **Anywhere:** one HTML file — any static host / S3 / CDN.

Local preview: `python3 -m http.server 8080` then open http://localhost:8080

Before publishing, replace `your-org` and the `*.pocket-t.app` URLs.
