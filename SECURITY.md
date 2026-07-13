# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's **Private Vulnerability
Reporting** — do not open a public issue and do not disclose the problem until a
fix is available.

1. Go to the repository's **Security** tab:
   <https://github.com/Josh-Gi3r/POCKET-T/security>
2. Click **Report a vulnerability**.
3. Describe the issue with enough detail to reproduce it: affected component
   (daemon, `pt` shim, relay, web UI), version or commit, impact, and a
   proof-of-concept if you have one.

The report stays private to the maintainers until it is resolved.

## Scope

Pocket-T turns any terminal into a browser-reachable session, so the components
most relevant to security are:

- the **`pt` shim** (`packages/pt-shim`) — runs as the user's login shell;
- the **daemon** (`packages/daemon`) — binds `127.0.0.1:7700` and, in tunnel
  mode, is reachable over the network;
- the **relay** (`packages/relay`) — the optional self-hosted ws hub.

Put a real authenticating proxy (e.g. Cloudflare Access) in front of any
tunnel — see [`docs/always-on-setup.md`](docs/always-on-setup.md).

## Supported versions

Pocket-T is pre-1.0. Fixes land on `main`; run the latest commit.

## Response

We aim to acknowledge a valid report within a few days and to ship a fix or a
mitigation as fast as the severity warrants, then credit the reporter unless
they ask to stay anonymous.
