<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from './components/Sidebar.svelte';
  import BubbleView from './components/BubbleView.svelte';
  import CostPill from './components/CostPill.svelte';
  import KeyboardRow from './components/KeyboardRow.svelte';
  import { status, current, sessions, conn } from './lib/store';
  import { enableNotifications, subscribeToPush, pushConfigured } from './lib/push';
  import type { ConnStatus } from './lib/types';

  // Lazily-imported terminal component — @xterm/xterm is only pulled in
  // when the user opens the Terminal tab (keeps the initial bundle lean).
  let TerminalView = $state<any>(null);
  let tab = $state<'bubbles' | 'terminal'>('bubbles');
  let drawerOpen = $state(false);
  let composer = $state('');
  let kbInset = $state(0);

  const statusLabel: Record<ConnStatus, string> = {
    connecting: 'connecting…',
    open: 'live',
    reconnecting: 'reconnecting…',
    closed: 'offline',
  };

  const currentSession = $derived($sessions.find((s) => s.sessionId === $current) ?? null);

  async function openTerminal() {
    tab = 'terminal';
    if (!TerminalView) {
      const mod = await import('./components/TerminalView.svelte');
      TerminalView = mod.default;
    }
  }

  function send() {
    const text = composer.trim();
    if (!text || !$current) return;
    // Send the line + Enter to the agent CLI's prompt via the PTY. Input is
    // queued while reconnecting, so it's never silently dropped — only clear
    // the composer once the connection has accepted (sent or buffered) it.
    if (conn.sendInput(text + '\r')) composer = '';
  }

  function onComposerKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function turnOnPush() {
    await enableNotifications();
    if (pushConfigured()) await subscribeToPush();
  }

  onMount(() => {
    // Deep-link from a push notification (?session=…).
    try {
      const s = new URLSearchParams(location.search).get('session');
      if (s) current.set(s);
    } catch {
      /* noop */
    }

    // visualViewport: when the soft keyboard opens, the layout viewport
    // doesn't shrink on iOS — the keyboard just overlaps. Track the gap
    // and lift the composer above it.
    const vv = window.visualViewport;
    if (vv) {
      const onResize = () => {
        const gap = window.innerHeight - vv.height - vv.offsetTop;
        kbInset = gap > 0 ? gap : 0;
      };
      vv.addEventListener('resize', onResize);
      vv.addEventListener('scroll', onResize);
      onResize();
      return () => {
        vv.removeEventListener('resize', onResize);
        vv.removeEventListener('scroll', onResize);
      };
    }
  });
</script>

<div class="shell" style="padding-bottom:{kbInset}px">
  <header class="topbar">
    <button class="icon-btn" aria-label="Sessions" onclick={() => (drawerOpen = true)}>☰</button>
    <div class="title">
      <span class="title-main">{currentSession?.vendor ?? currentSession?.shell ?? 'pocket-t'}</span>
      {#if currentSession}
        <span class="title-sub mono">{currentSession.cwd.split('/').slice(-1)[0] || '~'}</span>
      {/if}
    </div>
    <CostPill />
    <div class="status status-{$status}" title={statusLabel[$status]}>
      <span class="dot"></span>
    </div>
  </header>

  <nav class="tabs">
    <button class:active={tab === 'bubbles'} onclick={() => (tab = 'bubbles')}>Conversation</button>
    <button class:active={tab === 'terminal'} onclick={openTerminal}>Terminal</button>
  </nav>

  <main class="body">
    {#if !$current}
      <div class="empty">
        <p>No session selected.</p>
        <button class="primary" onclick={() => (drawerOpen = true)}>Open sessions</button>
      </div>
    {:else if tab === 'bubbles'}
      <BubbleView sessionId={$current} />
    {:else if TerminalView}
      <TerminalView sessionId={$current} />
    {:else}
      <div class="empty"><p>Loading terminal…</p></div>
    {/if}
  </main>

  {#if $current}
    <footer class="composer-wrap">
      {#if tab === 'terminal'}
        <KeyboardRow />
      {/if}
      <div class="composer">
        <textarea
          bind:value={composer}
          onkeydown={onComposerKey}
          placeholder="Message the agent…"
          rows="1"
        ></textarea>
        <button class="send" onclick={send} aria-label="Send" disabled={!composer.trim()}>↑</button>
      </div>
    </footer>
  {/if}

  <Sidebar bind:open={drawerOpen} onEnablePush={turnOnPush} />
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: var(--bg);
  }

  .topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: calc(var(--safe-top) + 8px) calc(var(--safe-right) + 12px) 8px
      calc(var(--safe-left) + 12px);
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
  }
  .icon-btn {
    background: none;
    border: none;
    font-size: 20px;
    padding: 4px 8px;
    color: var(--text);
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.1;
  }
  .title-main {
    font-weight: 600;
    font-size: 15px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title-sub {
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
    background: var(--text-dim);
  }
  .status-open .dot {
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
  }
  .status-connecting .dot,
  .status-reconnecting .dot {
    background: #e0b33f;
    animation: pulse 1s ease-in-out infinite;
  }
  .status-closed .dot {
    background: var(--danger);
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  .tabs {
    display: flex;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
    padding: 0 calc(var(--safe-left) + 8px) 0 calc(var(--safe-right) + 8px);
  }
  .tabs button {
    flex: 1;
    background: none;
    border: none;
    padding: 10px;
    color: var(--text-dim);
    font-size: 13px;
    font-weight: 600;
    border-bottom: 2px solid transparent;
  }
  .tabs button.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    color: var(--text-dim);
  }
  .primary,
  button.primary {
    background: var(--accent);
    color: #04150c;
    border: none;
    border-radius: 8px;
    padding: 10px 16px;
    font-weight: 700;
  }

  .composer-wrap {
    background: var(--bg-elev);
    border-top: 1px solid var(--border);
    padding-bottom: var(--safe-bottom);
  }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 8px calc(var(--safe-right) + 10px) 8px calc(var(--safe-left) + 10px);
  }
  .composer textarea {
    flex: 1;
    resize: none;
    max-height: 120px;
    background: var(--bg-card);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 10px 14px;
    font: inherit;
    font-size: 16px; /* keep >=16px so iOS doesn't zoom on focus */
    line-height: 1.3;
  }
  .composer textarea:focus {
    outline: none;
    border-color: var(--accent-dim);
  }
  .send {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: var(--accent);
    color: #04150c;
    font-size: 18px;
    font-weight: 800;
  }
  .send:disabled {
    background: var(--border);
    color: var(--text-dim);
  }
</style>
