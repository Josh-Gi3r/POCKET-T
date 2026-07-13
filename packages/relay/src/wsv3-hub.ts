// ws-v3 hub
//
// A minimal WebSocket multiplexer that sits between the pocket-t daemon
// (on a Mac, dialing OUTBOUND) and any browser (also dialing OUTBOUND).
// Same architecture as the production relay; this is just enough to
// prove the cross-network path end-to-end. It can run locally for
// testing or be deployed to any host with a public WSS endpoint.
//
// Endpoints (single HTTP server on $POCKET_T_HUB_PORT, default 4080):
//
//   GET  /                       → embedded HTML (xterm.js) for browsers
//   WS   /ws/pt?role=daemon&t=…  → daemon registers under account `t`
//   WS   /ws/pt?role=client&t=…  → browser subscribes under account `t`
//
// The query token `t` is the routing key that pairs a browser with its
// daemon under the same account. The hub itself only matches strings; it
// never inspects the token. Because the daemon additionally authenticates
// every browser at the ws-v3 layer (the token is echoed in the HELLO
// frame and checked against the daemon's bearer token), the routing token
// must BE the daemon's bearer token — the value the daemon prints after
// `t=` at startup. One value routes and authenticates.
//
// Frames pass through ws-v3 binary: when a daemon emits STDOUT for a
// session, the hub forwards that frame to every browser client under
// the same account. When a browser emits INPUT_TEXT, the hub forwards
// to every daemon under the same account (in practice there's only
// one daemon per account in this MVP).

import * as http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.POCKET_T_HUB_PORT ?? 4080);
const HOST = process.env.POCKET_T_HUB_HOST ?? '0.0.0.0';

interface Account {
  daemons: Set<WebSocket>;
  clients: Set<WebSocket>;
}

const accounts = new Map<string, Account>();

function getAccount(token: string): Account {
  let a = accounts.get(token);
  if (!a) {
    a = { daemons: new Set(), clients: new Set() };
    accounts.set(token, a);
  }
  return a;
}

function cleanupAccount(token: string): void {
  const a = accounts.get(token);
  if (a && a.daemons.size === 0 && a.clients.size === 0) {
    accounts.delete(token);
  }
}

function parseUrlParams(url: string): URLSearchParams {
  const idx = url.indexOf('?');
  if (idx < 0) return new URLSearchParams();
  return new URLSearchParams(url.slice(idx + 1));
}

function forward(from: WebSocket, peers: Set<WebSocket>, data: Buffer): void {
  for (const peer of peers) {
    if (peer === from) continue;
    if (peer.readyState !== WebSocket.OPEN) continue;
    peer.send(data);
  }
}

// Embedded HTML — same shape as the local pt-registry page but with a
// `?token=…` form so the user can paste their daemonId and connect.
const HUB_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>pocket-t hub</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
  <style>
    /*
     * Theme tokens. Skin authors override these in a body[data-theme=...]
     * block — that's all you need to ship a Nokia / Halloween / Christmas
     * / cyberpunk skin. Default is "midnight": dark indigo with a soft
     * violet accent.
     */
    :root {
      --pt-bg:           #0f0f12;
      --pt-fg:           #e8e8ea;
      --pt-muted:        #888;
      --pt-dim:          #666;
      --pt-border:       #26262d;
      --pt-sidebar-bg:   #16161a;
      --pt-card-bg:      transparent;
      --pt-card-hover:   #1f1f25;
      --pt-accent:       #4b3a78;
      --pt-accent-fg:    #ffffff;
      --pt-cursor:       #9b87d6;
      --pt-terminal-bg:  #0f0f12;
      --pt-terminal-fg:  #e8e8ea;
      --pt-font-ui:      -apple-system, system-ui, sans-serif;
      --pt-font-mono:    ui-monospace, Menlo, monospace;
    }
    body[data-theme="halloween"] {
      --pt-bg:           #1a0a00;
      --pt-fg:           #ffbf80;
      --pt-muted:        #b07040;
      --pt-border:       #4a2a10;
      --pt-sidebar-bg:   #200d04;
      --pt-card-hover:   #2a1408;
      --pt-accent:       #ff6a00;
      --pt-accent-fg:    #1a0a00;
      --pt-cursor:       #ff6a00;
      --pt-terminal-bg:  #1a0a00;
      --pt-terminal-fg:  #ffbf80;
    }
    body[data-theme="nokia"] {
      --pt-bg:           #051a0a;
      --pt-fg:           #95e600;
      --pt-muted:        #4a7320;
      --pt-border:       #1f3a14;
      --pt-sidebar-bg:   #082010;
      --pt-card-hover:   #0e2c17;
      --pt-accent:       #95e600;
      --pt-accent-fg:    #051a0a;
      --pt-cursor:       #95e600;
      --pt-terminal-bg:  #051a0a;
      --pt-terminal-fg:  #95e600;
      --pt-font-ui:      ui-monospace, Menlo, monospace;
    }
    body[data-theme="christmas"] {
      --pt-bg:           #0a1612;
      --pt-fg:           #f0ebe1;
      --pt-muted:        #88a89a;
      --pt-border:       #1f3a2c;
      --pt-sidebar-bg:   #0d1f17;
      --pt-card-hover:   #14301f;
      --pt-accent:       #c0392b;
      --pt-accent-fg:    #fff7e1;
      --pt-cursor:       #f5c542;
      --pt-terminal-bg:  #0a1612;
      --pt-terminal-fg:  #f0ebe1;
    }
    body[data-theme="cyberpunk"] {
      --pt-bg:           #0d0420;
      --pt-fg:           #f4f0fa;
      --pt-muted:        #b67de8;
      --pt-border:       #2a1660;
      --pt-sidebar-bg:   #15082e;
      --pt-card-hover:   #1f0e44;
      --pt-accent:       #ff2a92;
      --pt-accent-fg:    #ffffff;
      --pt-cursor:       #00ffe7;
      --pt-terminal-bg:  #0d0420;
      --pt-terminal-fg:  #00ffe7;
    }
    body[data-theme="forest"] {
      --pt-bg:           #131c12;
      --pt-fg:           #e4e8da;
      --pt-muted:        #99a685;
      --pt-border:       #2a3520;
      --pt-sidebar-bg:   #1a2418;
      --pt-card-hover:   #243020;
      --pt-accent:       #6b9a44;
      --pt-accent-fg:    #131c12;
      --pt-cursor:       #c9d68a;
      --pt-terminal-bg:  #131c12;
      --pt-terminal-fg:  #e4e8da;
    }
    body[data-theme="paper"] {
      --pt-bg:           #f7f3eb;
      --pt-fg:           #2a2520;
      --pt-muted:        #7a7065;
      --pt-dim:          #a89c8c;
      --pt-border:       #e0d8c8;
      --pt-sidebar-bg:   #f0e8d8;
      --pt-card-hover:   #e8e0d0;
      --pt-accent:       #4a3a78;
      --pt-accent-fg:    #ffffff;
      --pt-cursor:       #4a3a78;
      --pt-terminal-bg:  #f7f3eb;
      --pt-terminal-fg:  #2a2520;
    }
    body { margin: 0; font: 13px var(--pt-font-ui); background: var(--pt-bg); color: var(--pt-fg); }
    .auth { padding: 24px; max-width: 480px; margin: 60px auto; background: var(--pt-sidebar-bg); border-radius: 12px; }
    .auth h1 { margin: 0 0 16px 0; font-size: 18px; }
    .auth p { color: var(--pt-muted); line-height: 1.5; }
    .auth input { width: 100%; box-sizing: border-box; padding: 10px; background: var(--pt-card-hover); border: 1px solid var(--pt-border); color: var(--pt-fg); border-radius: 6px; font-family: var(--pt-font-mono); font-size: 13px; }
    .auth button { margin-top: 12px; padding: 10px 18px; background: var(--pt-accent); color: var(--pt-accent-fg); border: 0; border-radius: 6px; font-weight: 600; cursor: pointer; }
    .layout { display: grid; grid-template-columns: 240px 1fr; height: 100vh; }
    .sidebar { background: var(--pt-sidebar-bg); border-right: 1px solid var(--pt-border); padding: 14px; overflow-y: auto; }
    h2 { margin: 0 0 12px 0; font-size: 11px; font-weight: 600; color: var(--pt-muted); letter-spacing: 0.06em; text-transform: uppercase; }
    #status { font-size: 11px; color: var(--pt-dim); padding: 6px 0 12px; }
    .session { padding: 10px 12px; cursor: pointer; border-radius: 8px; margin-bottom: 4px; transition: background 80ms; background: var(--pt-card-bg); }
    .session:hover { background: var(--pt-card-hover); }
    .session.active { background: var(--pt-accent); color: var(--pt-accent-fg); }
    .session-name { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px; }
    .session-meta { font-size: 11px; color: var(--pt-muted); margin-top: 3px; font-family: var(--pt-font-mono); }
    .vendor-badge { display: inline-block; font-size: 9px; padding: 1px 6px; border-radius: 999px; background: var(--pt-accent); color: var(--pt-accent-fg); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; font-family: var(--pt-font-ui); }
    .session.active .vendor-badge { background: var(--pt-accent-fg); color: var(--pt-accent); }
    .empty { color: var(--pt-dim); font-style: italic; padding: 12px; line-height: 1.5; }
    .main { display: flex; flex-direction: column; min-width: 0; }
    .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--pt-border); font-size: 11px; color: var(--pt-muted); }
    .toolbar .grow { flex: 1; }
    .toolbar .pill { padding: 3px 8px; border-radius: 999px; background: var(--pt-card-hover); color: var(--pt-fg); cursor: pointer; user-select: none; }
    .toolbar .pill.active { background: var(--pt-accent); color: var(--pt-accent-fg); }
    .terminal-wrap { flex: 1; padding: 8px; min-height: 0; }
    #terminal { width: 100%; height: 100%; }
    .bubbles-wrap { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 22px; display: none; }
    .bubbles-wrap.show { display: block; }
    .bubble { max-width: 720px; margin: 10px auto; padding: 10px 14px; border-radius: 12px; line-height: 1.45; word-wrap: break-word; }
    .bubble.role-user { background: var(--pt-accent); color: var(--pt-accent-fg); margin-right: 0; margin-left: auto; max-width: 540px; }
    .bubble.role-assistant { background: var(--pt-sidebar-bg); color: var(--pt-fg); border: 1px solid var(--pt-border); }
    .bubble.kind-thought { background: transparent; color: var(--pt-muted); font-style: italic; border-left: 2px solid var(--pt-border); border-radius: 0; padding-left: 14px; max-width: 720px; margin-left: 0; opacity: 0.8; }
    .bubble.kind-action { background: var(--pt-card-hover); color: var(--pt-fg); font-family: var(--pt-font-mono); font-size: 12px; border-left: 3px solid var(--pt-accent); border-radius: 6px; }
    .bubble.kind-tool_result { background: transparent; color: var(--pt-dim); font-family: var(--pt-font-mono); font-size: 12px; border-left: 3px solid var(--pt-border); border-radius: 6px; max-height: 240px; overflow: auto; white-space: pre-wrap; padding: 10px 14px; }
    .bubble .bubble-label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--pt-muted); margin-bottom: 4px; font-weight: 600; font-family: var(--pt-font-ui); }
    .bubble pre { margin: 6px 0 0 0; white-space: pre-wrap; font-family: var(--pt-font-mono); font-size: 12px; }
    .bubble-text { white-space: pre-wrap; }
    .bubble-empty { color: var(--pt-dim); font-style: italic; text-align: center; margin-top: 60px; }
    .cost-pill { padding: 3px 10px; border-radius: 999px; background: var(--pt-card-hover); color: var(--pt-fg); font-family: var(--pt-font-mono); font-size: 11px; display: none; }
    .cost-pill.show { display: inline-block; }
    .cost-pill .cost-amount { font-weight: 700; }
    .cost-pill .cost-model { color: var(--pt-muted); margin-left: 6px; }
    .bubble.kind-approval { background: var(--pt-card-hover); border-left: 3px solid #ff7a45; border-radius: 8px; max-width: 720px; }
    .bubble.kind-approval .bubble-label { color: #ff7a45; }
    .bubble.kind-approval .approval-actions { margin-top: 10px; display: flex; gap: 8px; }
    .bubble.kind-approval button { padding: 6px 14px; border: 0; border-radius: 6px; font-weight: 600; cursor: pointer; font-family: var(--pt-font-ui); font-size: 12px; }
    .bubble.kind-approval button.approve { background: #2da256; color: white; }
    .bubble.kind-approval button.deny    { background: #d04444; color: white; }
    .bubble.kind-approval.resolved button { opacity: 0.4; pointer-events: none; }
    .session-pending { display: inline-block; background: #ff7a45; color: white; font-size: 9px; padding: 1px 6px; border-radius: 999px; font-weight: 700; }
    .session-detached { display: inline-block; background: var(--pt-dim); color: white; font-size: 9px; padding: 1px 6px; border-radius: 999px; font-weight: 700; }
    .theme-picker { padding: 3px 8px; border-radius: 999px; background: var(--pt-card-hover); color: var(--pt-fg); font-family: var(--pt-font-ui); font-size: 11px; border: 0; cursor: pointer; }
  </style>
</head>
<body>
  <div id="root"></div>
<script>
  const WS_V3_MAGIC = 0x5450, WS_V3_VERSION = 3;
  const T = { HELLO:1, WELCOME:2, SUBSCRIBE:10, UNSUBSCRIBE:11,
              STDOUT:20, SNAPSHOT_VT:21, EVENT:22, ERROR:23,
              INPUT_TEXT:30, INPUT_KEY:31, RESIZE:32, KILL:33, RESET_SIZE:34,
              PING:40, PONG:41 };
  const FLAG = { STDOUT:1, SNAPSHOTS:2, EVENTS:4 };

  function encodeFrame(type, sessionId='', payload=new Uint8Array()) {
    const sid = new TextEncoder().encode(sessionId);
    const out = new Uint8Array(12 + sid.length + payload.length);
    const v = new DataView(out.buffer);
    let o = 0;
    v.setUint16(o, WS_V3_MAGIC, true); o += 2;
    v.setUint8(o, WS_V3_VERSION); o += 1;
    v.setUint8(o, type); o += 1;
    v.setUint32(o, sid.length, true); o += 4;
    out.set(sid, o); o += sid.length;
    v.setUint32(o, payload.length, true); o += 4;
    out.set(payload, o);
    return out;
  }
  function decodeFrame(d) {
    if (d.byteLength < 12) return null;
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    let o = 0;
    if (v.getUint16(o, true) !== WS_V3_MAGIC) return null;
    o += 2;
    if (v.getUint8(o) !== WS_V3_VERSION) return null;
    o += 1;
    const type = v.getUint8(o); o += 1;
    const sl = v.getUint32(o, true); o += 4;
    if (o + sl > d.byteLength) return null;
    const sid = new TextDecoder().decode(d.subarray(o, o + sl));
    o += sl;
    const pl = v.getUint32(o, true); o += 4;
    if (o + pl > d.byteLength) return null;
    return { type, sessionId: sid, payload: d.subarray(o, o + pl) };
  }
  function encodeSubPayload(flags) {
    const out = new Uint8Array(12);
    new DataView(out.buffer).setUint32(0, flags >>> 0, true);
    return out;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  }

  // Token-from-URL fast path: ?token=foo lets you skip the form.
  const urlParams = new URLSearchParams(location.search);
  const presetToken = urlParams.get('token') || urlParams.get('t');

  if (presetToken) {
    boot(presetToken);
  } else {
    renderAuth();
  }

  function renderAuth() {
    document.getElementById('root').innerHTML = \`
      <div class="auth">
        <h1>pocket-t hub</h1>
        <p>Paste your daemon token — the value after <code>t=</code> in the
        URL the daemon prints at startup. It both routes you to your daemon
        and authenticates you to it.</p>
        <input id="token" placeholder="daemon token" autofocus>
        <button onclick="window._connect()">Connect</button>
      </div>\`;
    window._connect = () => {
      const t = document.getElementById('token').value.trim();
      if (t) boot(t);
    };
  }

  function boot(token) {
    document.getElementById('root').innerHTML = \`
      <div class="layout">
        <div class="sidebar">
          <h2>pocket-t sessions</h2>
          <div id="status">connecting…</div>
          <div id="sessions"></div>
        </div>
        <div class="main">
          <div class="toolbar">
            <span id="title">no session selected</span>
            <span class="grow"></span>
            <span id="cost-pill" class="cost-pill"><span class="cost-amount">$0.00</span><span class="cost-model"></span></span>
            <select id="theme-picker" class="theme-picker" onchange="window.__pt_setTheme(this.value)">
              <option value="">midnight (default)</option>
              <option value="halloween">halloween</option>
              <option value="nokia">nokia</option>
              <option value="christmas">christmas</option>
              <option value="cyberpunk">cyberpunk</option>
              <option value="forest">forest</option>
              <option value="paper">paper</option>
            </select>
            <span class="pill active" data-view="terminal" onclick="window.__pt_setView('terminal')">Terminal</span>
            <span class="pill" data-view="bubbles" onclick="window.__pt_setView('bubbles')">Bubbles</span>
          </div>
          <div class="terminal-wrap"><div id="terminal"></div></div>
          <div class="bubbles-wrap" id="bubbles"></div>
        </div>
      </div>\`;

    // ?theme=… overrides; otherwise last-picked theme (localStorage).
    const themeParam = new URLSearchParams(location.search).get('theme');
    const savedTheme = localStorage.getItem('pt-theme') || '';
    const initialTheme = themeParam || savedTheme;
    if (initialTheme) document.body.setAttribute('data-theme', initialTheme);
    setTimeout(() => {
      const picker = document.getElementById('theme-picker');
      if (picker) picker.value = initialTheme;
    }, 0);
    window.__pt_setTheme = (val) => {
      if (val) document.body.setAttribute('data-theme', val);
      else document.body.removeAttribute('data-theme');
      localStorage.setItem('pt-theme', val);
      if (window.__pt_term) {
        window.__pt_term.options.theme = {
          background: getCssVar('--pt-terminal-bg') || '#0f0f12',
          foreground: getCssVar('--pt-terminal-fg') || '#e8e8ea',
          cursor:     getCssVar('--pt-cursor')      || '#9b87d6',
        };
      }
    };

    // desktop notifications on remote browser. Same gesture-
    // gated permission flow as the local pt-registry page; one ask per
    // origin. On mobile Safari this becomes a Web Push permission
    // (browsers translate Notification API → push under the hood for
    // PWA-installed pages).
    let notifAsked = false;
    function maybeAskNotif() {
      if (notifAsked) return;
      notifAsked = true;
      try {
        if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission().catch(() => {});
        }
      } catch (_) {}
    }
    document.addEventListener('click', maybeAskNotif, { once: true });
    document.addEventListener('keydown', maybeAskNotif, { once: true });
    function fireNotif(title, body) {
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          const n = new Notification(title, { body, tag: 'pt-approval' });
          n.onclick = () => { window.focus(); n.close(); };
        }
      } catch (_) {}
    }

    function getCssVar(name) {
      return getComputedStyle(document.body).getPropertyValue(name).trim();
    }

    const term = new Terminal({
      fontFamily: getCssVar('--pt-font-mono') || 'ui-monospace, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: getCssVar('--pt-terminal-bg') || '#0f0f12',
        foreground: getCssVar('--pt-terminal-fg') || '#e8e8ea',
        cursor:     getCssVar('--pt-cursor')      || '#9b87d6',
      },
    });
    term.open(document.getElementById('terminal'));
    window.__pt_term = term;

    const FitAddonCtor = (window.FitAddon && window.FitAddon.FitAddon) || null;
    const fit = FitAddonCtor ? new FitAddonCtor() : null;
    if (fit) term.loadAddon(fit);

    let lastSentCols = 0;
    let lastSentRows = 0;
    function encodeResizePayloadJS(cols, rows) {
      const out = new Uint8Array(8);
      const v = new DataView(out.buffer);
      v.setUint32(0, cols >>> 0, true);
      v.setUint32(4, rows >>> 0, true);
      return out;
    }
    function doFit() {
      if (!fit) return;
      try { fit.fit(); } catch (_) { return; }
      const c = term.cols, r = term.rows;
      if (c === lastSentCols && r === lastSentRows) return;
      lastSentCols = c; lastSentRows = r;
      if (currentSession && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(encodeFrame(T.RESIZE, currentSession, encodeResizePayloadJS(c, r)));
      }
    }
    setTimeout(doFit, 0);
    window.addEventListener('resize', () => requestAnimationFrame(doFit));
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => doFit()).observe(document.querySelector('.terminal-wrap'));
    }

    const bubblesBySession = new Map();
    const costBySession    = new Map();
    const bubblesEl = document.getElementById('bubbles');
    function fmtParams(params) {
      if (!params || typeof params !== 'object') return '';
      const key = params.file_path ?? params.path ?? params.command ?? params.pattern ?? params.url ?? '';
      return typeof key === 'string' && key.length > 0 ? key.slice(0, 200) : '';
    }
    function bubbleHTML(ev) {
      const role = ev.role === 'user' ? 'user' : 'assistant';
      const kind = ev.kind;
      if (kind === 'chat') {
        return '<div class="bubble role-' + role + ' kind-chat"><div class="bubble-text">' + esc(ev.text || '') + '</div></div>';
      }
      if (kind === 'thought') {
        return '<div class="bubble kind-thought"><span class="bubble-label">thinking</span><div class="bubble-text">' + esc(ev.text || '') + '</div></div>';
      }
      if (kind === 'action') {
        const params = JSON.stringify(ev.parameters || {}, null, 2);
        const summary = fmtParams(ev.parameters);
        return '<div class="bubble kind-action"><span class="bubble-label">tool · ' + esc(ev.tool || 'unknown') + '</span>' +
               (summary ? '<div class="bubble-text">' + esc(summary) + '</div>' : '') +
               '<pre>' + esc(params) + '</pre></div>';
      }
      if (kind === 'tool_result') {
        const out = (ev.output || '').slice(0, 4000);
        return '<div class="bubble kind-tool_result"><span class="bubble-label">result</span>' + esc(out) + '</div>';
      }
      if (kind === 'approval') {
        if (!ev.approvalId || /^[✓✗]/.test(ev.text || '')) {
          return '<div class="bubble kind-approval resolved"><span class="bubble-label">approval</span>' +
                 '<div class="bubble-text">' + esc(ev.text || '') + '</div></div>';
        }
        const params = JSON.stringify(ev.parameters || {}, null, 2);
        const summary = fmtParams(ev.parameters);
        return '<div class="bubble kind-approval" data-approval-id="' + esc(ev.approvalId) + '">' +
               '<span class="bubble-label">approval needed · ' + esc(ev.tool || 'tool') + '</span>' +
               (summary ? '<div class="bubble-text">' + esc(summary) + '</div>' : '') +
               '<pre>' + esc(params) + '</pre>' +
               '<div class="approval-actions">' +
                 '<button class="approve" data-decision="approve">Approve</button>' +
                 '<button class="deny" data-decision="deny">Deny</button>' +
               '</div></div>';
      }
      return '';
    }
    // Click delegate — handles approval buttons regardless of when they
    // were rendered. Frames forward through the hub unchanged to the
    // daemon, which calls HookServer.resolveApproval() and unblocks
    // whatever Claude tool was waiting.
    bubblesEl.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('button[data-decision]');
      if (!btn) return;
      const card = btn.closest('.bubble.kind-approval');
      if (!card) return;
      const approvalId = card.getAttribute('data-approval-id');
      const decision   = btn.getAttribute('data-decision');
      if (!approvalId || !decision) return;
      if (!currentSession || !ws || ws.readyState !== WebSocket.OPEN) return;
      const msg = { kind: 'approvalDecision', approvalId, decision };
      ws.send(encodeFrame(T.EVENT, currentSession, new TextEncoder().encode(JSON.stringify(msg))));
      card.classList.add('resolved');
    });
    function renderBubbles() {
      if (!currentSession) {
        bubblesEl.innerHTML = '<div class="bubble-empty">no session selected.</div>';
        return;
      }
      const list = (bubblesBySession.get(currentSession) || []).filter(ev => ev.kind !== 'cost');
      if (list.length === 0) {
        bubblesEl.innerHTML = '<div class="bubble-empty">waiting for agent activity…<br>(run <code>claude</code>, <code>codex</code>, or any supported agent CLI)</div>';
        return;
      }
      bubblesEl.innerHTML = list.map(bubbleHTML).join('');
      bubblesEl.scrollTop = bubblesEl.scrollHeight;
    }
    function appendBubble(ev) {
      if (ev.kind === 'cost') return;
      const wasAtBottom = bubblesEl.scrollTop + bubblesEl.clientHeight >= bubblesEl.scrollHeight - 8;
      const html = bubbleHTML(ev);
      if (!html) return;
      if (bubblesEl.querySelector('.bubble-empty')) bubblesEl.innerHTML = html;
      else bubblesEl.insertAdjacentHTML('beforeend', html);
      if (wasAtBottom) bubblesEl.scrollTop = bubblesEl.scrollHeight;
    }
    function updateCostPill() {
      const pill = document.getElementById('cost-pill');
      if (!currentSession) { pill.classList.remove('show'); return; }
      const c = costBySession.get(currentSession);
      if (!c) { pill.classList.remove('show'); return; }
      const dollars = (c.cumulativeCostUSD || 0).toFixed(4).replace(/0+$/, '').replace(/\\.$/, '.00');
      pill.querySelector('.cost-amount').textContent = '$' + dollars;
      pill.querySelector('.cost-model').textContent = c.model ? '· ' + c.model.split('-').slice(0, 2).join(' ') : '';
      pill.classList.add('show');
    }

    let viewMode = 'terminal';
    window.__pt_setView = (mode) => {
      viewMode = mode;
      document.querySelectorAll('.toolbar .pill').forEach(p => {
        p.classList.toggle('active', p.dataset.view === mode);
      });
      document.querySelector('.terminal-wrap').style.display = (mode === 'terminal') ? '' : 'none';
      bubblesEl.classList.toggle('show', mode === 'bubbles');
      if (mode === 'bubbles') renderBubbles();
      setTimeout(doFit, 0);
    };

    let currentSession = null;
    const sessions = new Map();

    function renderSessions() {
      const el = document.getElementById('sessions');
      if (sessions.size === 0) {
        el.innerHTML = '<div class="empty">waiting for daemon to connect…</div>';
        return;
      }
      el.innerHTML = '';
      for (const [id, s] of sessions) {
        const div = document.createElement('div');
        div.className = 'session' + (id === currentSession ? ' active' : '');
        const cwdShort = (s.cwd || '~').replace(/^\\/Users\\/[^/]+/, '~');
        const badges =
          (s.vendor    ? '<span class="vendor-badge">'   + esc(s.vendor) + '</span>' : '') +
          (s.pendingApprovals > 0
            ? '<span class="session-pending">' + s.pendingApprovals + ' approve</span>'
            : '') +
          (s.detached  ? '<span class="session-detached">detached</span>' : '');
        div.innerHTML =
          '<div class="session-name"><span>' + esc(id) + '</span>' + badges + '</div>' +
          '<div class="session-meta">' + esc(cwdShort) + ' · ' + s.rows + '×' + s.cols + '</div>';
        div.onclick = () => attach(id);
        el.appendChild(div);
      }
    }

    let ws = null;
    function connect() {
      const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host +
                    '/ws/pt?role=client&t=' + encodeURIComponent(token);
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';

      ws.addEventListener('open', () => {
        document.getElementById('status').textContent = 'connected via hub';
        // HELLO payload = [protocolVersion, ...tokenUtf8]. The hub is a dumb
        // pipe, so this token is the only thing that authenticates us to the
        // daemon at the ws-v3 layer — the daemon drops every privileged
        // frame until it verifies it. Use the daemon's bearer token as the
        // relay account token so this single value serves both roles.
        const tokenBytes = new TextEncoder().encode(token);
        const hello = new Uint8Array(1 + tokenBytes.length);
        hello[0] = 3;
        hello.set(tokenBytes, 1);
        ws.send(encodeFrame(T.HELLO, '', hello));
        if (currentSession) {
          ws.send(encodeFrame(T.SUBSCRIBE, currentSession, encodeSubPayload(FLAG.STDOUT | FLAG.SNAPSHOTS | FLAG.EVENTS)));
        }
      });
      ws.addEventListener('message', (e) => {
        const f = decodeFrame(new Uint8Array(e.data));
        if (!f) return;
        if (f.type === T.STDOUT && f.sessionId === currentSession) {
          term.write(f.payload);
        } else if (f.type === T.SNAPSHOT_VT && f.sessionId === currentSession) {
          // Mid-session attach: paint the current Mac terminal screen
          // before live output continues.
          term.write(new TextDecoder().decode(f.payload));
        } else if (f.type === T.EVENT) {
          try {
            const ev = JSON.parse(new TextDecoder().decode(f.payload));
            if (ev.kind === 'sessionAdded') {
              sessions.set(ev.session.sessionId, ev.session);
              renderSessions();
            } else if (ev.kind === 'sessionUpdated') {
              sessions.set(ev.session.sessionId, ev.session);
              renderSessions();
              if (f.sessionId === currentSession) updateCostPill();
            } else if (ev.kind === 'sessionRemoved') {
              sessions.delete(f.sessionId);
              if (currentSession === f.sessionId) {
                currentSession = null;
                term.clear();
                term.write('\\r\\n[session ended]\\r\\n');
                bubblesEl.innerHTML = '<div class="bubble-empty">session ended.</div>';
                updateCostPill();
              }
              renderSessions();
            } else if (ev.kind === 'bubble') {
              const sid = ev.sessionId;
              const bev = ev.event;
              const arr = bubblesBySession.get(sid) || [];
              arr.push(bev);
              bubblesBySession.set(sid, arr);
              if (bev.kind === 'cost') {
                costBySession.set(sid, { cumulativeCostUSD: bev.cumulativeCostUSD, model: bev.model });
                if (sid === currentSession) updateCostPill();
              } else if (sid === currentSession && viewMode === 'bubbles') {
                appendBubble(bev);
              }
              if (bev.kind === 'approval' && bev.approvalId && !/^[✓✗]/.test(bev.text || '')) {
                fireNotif('pocket-t · approval needed',
                  (bev.tool ? bev.tool + ' — ' : '') + (bev.text || 'tool wants to run'));
              }
            }
          } catch (_) {}
        }
      });
      ws.addEventListener('close', () => {
        document.getElementById('status').textContent = 'disconnected — retrying in 2s…';
        setTimeout(connect, 2000);
      });
    }

    function attach(id) {
      if (currentSession === id) return;
      if (currentSession && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(encodeFrame(T.UNSUBSCRIBE, currentSession));
      }
      currentSession = id;
      document.getElementById('title').textContent = id;
      bubblesBySession.set(id, []);
      costBySession.delete(id);
      lastSentCols = 0;
      lastSentRows = 0;
      term.reset();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(encodeFrame(T.SUBSCRIBE, id, encodeSubPayload(FLAG.STDOUT | FLAG.SNAPSHOTS | FLAG.EVENTS)));
      }
      renderSessions();
      renderBubbles();
      updateCostPill();
      term.focus();
      setTimeout(doFit, 0);
    }

    term.onData(data => {
      if (!currentSession || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(encodeFrame(T.INPUT_TEXT, currentSession, new TextEncoder().encode(data)));
    });

    renderSessions();
    connect();
  }
</script>
</body>
</html>`;

function main(): void {
  const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url?.startsWith('/?'))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HUB_PAGE_HTML);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws/pt')) {
      socket.destroy();
      return;
    }
    const params = parseUrlParams(req.url);
    const role  = params.get('role');
    const token = params.get('t') || params.get('token');
    if ((role !== 'daemon' && role !== 'client') || !token) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const account = getAccount(token);
      const peers   = role === 'daemon' ? account.daemons : account.clients;
      const others  = role === 'daemon' ? account.clients : account.daemons;
      peers.add(ws);
      console.log(`[hub] + ${role} on token=${token.slice(0, 8)}… (d=${account.daemons.size} c=${account.clients.size})`);

      ws.on('message', (raw: Buffer) => {
        // ws-v3 is binary — straight forward. We don't parse here; the
        // hub is a dumb pipe between equal peers under the same token.
        forward(ws, others, Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
      });
      ws.on('close', () => {
        peers.delete(ws);
        cleanupAccount(token);
        console.log(`[hub] - ${role} on token=${token.slice(0, 8)}… (d=${account.daemons.size} c=${account.clients.size})`);
      });
      ws.on('error', () => {
        peers.delete(ws);
        cleanupAccount(token);
      });
    });
  });

  httpServer.listen(PORT, HOST, () => {
    console.log(`[hub] listening on http://${HOST}:${PORT}/`);
    console.log(`[hub] daemon should dial: ws://${HOST}:${PORT}/ws/pt?role=daemon&t=<token>`);
    console.log(`[hub] browser should open: http://${HOST}:${PORT}/?token=<token>`);
  });
}

main();
