<script lang="ts">
  import { onMount } from 'svelte';
  import BubbleView from './components/BubbleView.svelte';
  import CostPill from './components/CostPill.svelte';
  import KeyboardRow from './components/KeyboardRow.svelte';
  import { status, current, sessions, bubbles, conn, attach, spawnSession, killSession } from './lib/store';
  import { enableNotifications, subscribeToPush, pushConfigured } from './lib/push';
  import type { SessionInfo } from './lib/types';

  type Page = 'home' | 'workspace' | 'machine';
  type Surface = 'activity' | 'terminal';
  type QuickAction = 'summary' | 'review' | 'tests' | 'status';

  // Use browser speech input when available. No speech is sent until the
  // user reviews the transcript and presses Send.
  interface SpeechResult {
    results: ArrayLike<ArrayLike<{ transcript: string }>>;
  }
  interface SpeechInput {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((event: SpeechResult) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
  }
  type SpeechInputConstructor = new () => SpeechInput;

  let page = $state<Page>('home');
  let surface = $state<Surface>('activity');
  let mobileMenu = $state(false);
  let composerOpen = $state(false);
  let composer = $state('');
  let listening = $state(false);
  let voiceDraft = $state('');
  let speechSupported = $state(false);
  let speech: SpeechInput | null = null;
  let createBusy = $state(false);
  let toast = $state('');
  let kbInset = $state(0);
  let TerminalView = $state<any>(null);

  const selected = $derived($sessions.find((s) => s.sessionId === $current) ?? null);
  const pending = $derived($sessions.reduce((sum, s) => sum + (s.pendingApprovals ?? 0), 0));
  const recent = $derived(
    ($current ? $bubbles[$current] ?? [] : [])
      .filter((ev) => ev.kind === 'chat' || ev.kind === 'action' || ev.kind === 'error')
      .slice(-3)
      .reverse(),
  );
  const connected = $derived($status === 'open');

  function titleOf(s: SessionInfo): string {
    return s.cwd.split('/').filter(Boolean).pop() || 'Shell';
  }

  function agentOf(s: SessionInfo): string {
    if (s.vendor === 'claude') return 'Claude Code';
    if (s.vendor === 'codex') return 'Codex';
    if (s.vendor) return s.vendor.charAt(0).toUpperCase() + s.vendor.slice(1);
    return 'Terminal';
  }

  function timeAgo(value: number): string {
    const elapsed = Math.max(0, Date.now() - value);
    if (elapsed < 60_000) return 'just now';
    if (elapsed < 3_600_000) return Math.floor(elapsed / 60_000) + 'm ago';
    if (elapsed < 86_400_000) return Math.floor(elapsed / 3_600_000) + 'h ago';
    return Math.floor(elapsed / 86_400_000) + 'd ago';
  }

  function selectSession(sid: string): void {
    attach(sid);
    page = 'workspace';
    surface = 'activity';
    mobileMenu = false;
  }

  function goHome(): void {
    page = 'home';
    mobileMenu = false;
  }

  async function startSession(): Promise<void> {
    if (!connected || createBusy) return;
    createBusy = true;
    spawnSession();
    page = 'workspace';
    mobileMenu = false;
    notify('Opening a session on your Mac…');
    window.setTimeout(() => (createBusy = false), 1200);
  }

  function notify(message: string): void {
    toast = message;
    window.setTimeout(() => {
      if (toast === message) toast = '';
    }, 3500);
  }

  function send(): void {
    const message = composer.trim();
    if (!message || !$current) return;
    const sent = conn.sendInput(message + '\r');
    if (sent) {
      composer = '';
      composerOpen = false;
      surface = 'activity';
      notify(connected ? 'Sent to your Mac' : 'Queued until your Mac reconnects');
    }
  }

  function onComposerKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function quickAction(action: QuickAction): void {
    if (!$current) return;
    // A shell and an interactive AI agent have different input semantics.
    // Never feed a shell command to an agent prompt by accident.
    const forAgent: Record<QuickAction, string> = {
      summary: 'Give me a short progress update: what is done, what is running, and what needs my attention.',
      review: 'Show me which files changed and review the changes for bugs or risks. Do not modify anything.',
      tests: 'Run the relevant tests for the current project and summarise the results.',
      status: 'Tell me the current project and Git status. Do not change anything.',
    };
    const forShell: Record<QuickAction, string> = {
      summary: 'pwd && git status --short',
      review: 'git diff --stat && git diff --check',
      tests: 'git status --short',
      status: 'pwd && git status --short --branch',
    };
    const message = selected?.vendor ? forAgent[action] : forShell[action];
    if (conn.sendInput(message + '\r')) {
      page = 'workspace';
      surface = 'activity';
      notify(connected ? 'Request sent' : 'Request queued until reconnect');
    }
  }

  async function openTerminal(): Promise<void> {
    surface = 'terminal';
    page = 'workspace';
    if (!TerminalView) {
      try {
        const mod = await import('./components/TerminalView.svelte');
        TerminalView = mod.default;
      } catch {
        notify('Terminal could not load. Please retry.');
      }
    }
  }

  function startVoice(): void {
    if (listening) {
      speech?.stop();
      return;
    }
    const w = window as Window & {
      SpeechRecognition?: SpeechInputConstructor;
      webkitSpeechRecognition?: SpeechInputConstructor;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      composerOpen = true;
      notify('Browser speech input is unavailable. Use keyboard dictation instead.');
      return;
    }
    const recorder = new Ctor();
    speech = recorder;
    voiceDraft = '';
    recorder.lang = 'en-US';
    recorder.continuous = false;
    recorder.interimResults = true;
    recorder.onresult = (event) => {
      const parts: string[] = [];
      for (let i = 0; i < event.results.length; i += 1) {
        parts.push(event.results[i]?.[0]?.transcript ?? '');
      }
      voiceDraft = parts.join(' ').trim();
    };
    recorder.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        notify('Microphone unavailable: ' + event.error);
      }
      listening = false;
    };
    recorder.onend = () => {
      listening = false;
      if (voiceDraft.trim()) {
        composer = (composer.trim() ? composer.trim() + ' ' : '') + voiceDraft.trim();
        composerOpen = true;
      }
      voiceDraft = '';
      speech = null;
    };
    try {
      recorder.start();
      listening = true;
    } catch {
      notify('Could not start voice input');
      speech = null;
    }
  }

  async function turnOnPush(): Promise<void> {
    const permission = await enableNotifications();
    if (permission === 'granted' && pushConfigured()) {
      await subscribeToPush();
      notify('Notifications enabled');
    } else if (permission === 'granted') {
      notify('Local notifications enabled. Remote push needs VAPID configuration.');
    } else {
      notify('Notification permission not granted');
    }
  }

  onMount(() => {
    const w = window as Window & {
      SpeechRecognition?: SpeechInputConstructor;
      webkitSpeechRecognition?: SpeechInputConstructor;
    };
    speechSupported = !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // On iOS the software keyboard overlays the viewport. Raise the
      // composer only by the occluded portion rather than resize the app.
      kbInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      speech?.stop();
    };
  });
</script>

<svelte:head>
  <title>Pocket-T · Your workspace, anywhere</title>
  <meta name="theme-color" content="#090e16" />
</svelte:head>

<div class="app" style:padding-bottom={kbInset + 'px'}>
  <div class="ambient ambient-one"></div>
  <div class="ambient ambient-two"></div>

  {#if mobileMenu}
    <button class="mobile-scrim" aria-label="Close navigation" onclick={() => (mobileMenu = false)}></button>
  {/if}

  <aside class:mobile-open={mobileMenu} class="rail" aria-label="Workspace navigation">
    <button class="brand" onclick={goHome} aria-label="Pocket-T home">
      <span class="mark"><span class="mark-inner">T</span></span>
      <span class="brand-text">pocket<span class="brand-dot">.</span>t <small>WORKSPACE</small></span>
    </button>

    <div class="rail-section-label">YOUR SPACE</div>
    <nav class="primary-nav" aria-label="Primary navigation">
      <button class:active={page === 'home'} onclick={goHome}>
        <span class="nav-icon">⌂</span> Overview
      </button>
      <button class:active={page === 'workspace'} onclick={() => {
        page = 'workspace';
        mobileMenu = false;
      }}>
        <span class="nav-icon">◫</span> Sessions
        {#if $sessions.length}<span class="nav-counter">{$sessions.length}</span>{/if}
      </button>
      <button class:active={page === 'machine'} onclick={() => {
        page = 'machine';
        mobileMenu = false;
      }}>
        <span class="nav-icon">▣</span> My Mac
        <span class="nav-soon">PLAN</span>
      </button>
    </nav>

    <div class="session-rail-header">
      <span>LIVE WORK</span>
      <button aria-label="New session" title="New session" onclick={startSession} disabled={!connected}>＋</button>
    </div>
    <div class="session-rail-list">
      {#each $sessions as s (s.sessionId)}
        <button class:selected={s.sessionId === $current && page === 'workspace'} class="rail-session" onclick={() => selectSession(s.sessionId)}>
          <span class="session-glyph" class:agent={!!s.vendor}>{s.vendor === 'claude' ? '✳' : s.vendor === 'codex' ? '⌘' : '>_'}</span>
          <span class="session-copy">
            <strong>{titleOf(s)}</strong>
            <small>{agentOf(s)} · {s.detached ? 'Detached' : timeAgo(s.lastActiveAt)}</small>
          </span>
          {#if s.pendingApprovals > 0}
            <span class="approval-dot" title="Approval required"></span>
          {:else}
            <span class="live-dot" class:off={s.detached}></span>
          {/if}
        </button>
      {/each}
      {#if !$sessions.length}
        <div class="rail-empty">No sessions yet.<br />Open one to get started.</div>
      {/if}
    </div>

    <div class="rail-bottom">
      <button class="notification-option" onclick={turnOnPush}><span>♧</span> Enable notifications <span class="tiny-arrow">↗</span></button>
      <div class="machine-mini">
        <span class="machine-avatar">⌘</span>
        <div><strong>Your Mac</strong><small>{connected ? 'Connected' : $status === 'reconnecting' ? 'Reconnecting' : 'Offline'}</small></div>
        <span class="machine-status" class:offline={!connected}></span>
      </div>
    </div>
  </aside>

  <main class="main">
    <header class="mobile-top">
      <button class="mobile-menu-button" aria-label="Open navigation" onclick={() => (mobileMenu = true)}>☰</button>
      <span class="mobile-brand">pocket<span>.</span>t</span>
      <span class="mobile-presence"><span class:offline={!connected}></span>{connected ? 'LIVE' : 'OFFLINE'}</span>
    </header>

    {#if page === 'home'}
      <div class="content home-content">
        <div class="topline">
          <div class="crumb">WORKSPACE <span>/</span> OVERVIEW</div>
          <span class="connection-label"><span class:offline={!connected}></span>{connected ? 'MAC CONNECTED' : 'MAC DISCONNECTED'}</span>
        </div>
        <div class="hero">
          <div class="hero-eyebrow"><span class="shine"></span> YOUR COMMAND CENTRE</div>
          <h1>Your work.<br /><em>Within reach.</em></h1>
          <p>Pick up where you left off, guide your agents, and keep your Mac moving — from wherever you are.</p>
          <div class="hero-actions">
            <button class="main-cta" onclick={() => $sessions[0] ? selectSession($sessions[0].sessionId) : startSession()} disabled={!connected}>
              {$sessions.length ? 'Resume your work' : 'Start a session'} <span>↗</span>
            </button>
            <button class="light-cta" onclick={() => { page = 'workspace'; mobileMenu = false; }}>View sessions <span>→</span></button>
          </div>
          <div class="hero-halo"><span class="halo-a"></span><span class="halo-b"></span><span class="halo-core">T</span></div>
        </div>

        <div class="stats-grid">
          <div class="metric">
            <span>ACTIVE SESSIONS</span><strong>{$sessions.filter((s) => !s.detached).length.toString().padStart(2, '0')}</strong>
            <small>Running on your Mac</small>
          </div>
          <div class="metric">
            <span>NEEDS YOUR INPUT</span><strong class:alert={pending > 0}>{pending.toString().padStart(2, '0')}</strong>
            <small>{pending > 0 ? 'Approvals awaiting review' : 'Nothing requires attention'}</small>
          </div>
          <div class="metric">
            <span>CONNECTION</span><strong class="connection-metric">{connected ? 'Live' : 'Offline'}</strong>
            <small>{connected ? 'Remote access available' : 'Waiting for your daemon'}</small>
          </div>
        </div>

        <div class="section-top"><div><span class="section-kicker">PICK UP WHERE YOU LEFT OFF</span><h2>Recent sessions</h2></div><button class="section-action" onclick={startSession} disabled={!connected}>+ New session</button></div>

        <div class="workspace-cards">
          {#each $sessions.slice(0, 4) as s (s.sessionId)}
            <button class="workspace-card" onclick={() => selectSession(s.sessionId)}>
              <span class="card-main-icon">{s.vendor === 'claude' ? '✳' : s.vendor === 'codex' ? '⌘' : '⌁'}</span>
              <span class="card-info"><strong>{titleOf(s)}</strong><small>{agentOf(s)} · {s.cwd}</small></span>
              {#if s.pendingApprovals > 0}<span class="card-review">{s.pendingApprovals} TO REVIEW</span>{:else}<span class="card-go">↗</span>{/if}
            </button>
          {/each}
          {#if !$sessions.length}
            <div class="empty-card">
              <span class="empty-symbol">⌘</span>
              <strong>Nothing running yet</strong>
              <p>Once you start a session on your Mac, it will appear here automatically.</p>
              <button onclick={startSession} disabled={!connected}>Open your first session <span>↗</span></button>
            </div>
          {/if}
        </div>
      </div>
    {:else if page === 'workspace'}
      <div class="session-page">
        <div class="session-header">
          <div class="session-header-main">
            <span class="eyebrow">LIVE WORKSPACE <span> / </span> {selected ? agentOf(selected) : 'SESSIONS'}</span>
            <div class="session-heading"><h1>{selected ? titleOf(selected) : 'Your sessions'}</h1>{#if selected}<span class="session-pill">{selected.detached ? 'DETACHED' : 'ACTIVE'}</span>{/if}</div>
            <div class="workspace-path">{selected?.cwd ?? 'Choose a session from the left, or create one to get started.'}</div>
          </div>
          <div class="header-tools">
            {#if selected}<CostPill />{/if}
            <button class="tool-button" title="Start new session" aria-label="Start new session" onclick={startSession} disabled={!connected}>＋</button>
          </div>
        </div>

        {#if selected}
          <div class="workspace-main">
            <div class="conversation-column">
              <div class="surface-tabs" role="tablist" aria-label="Session view">
                <button role="tab" aria-selected={surface === 'activity'} class:active={surface === 'activity'} onclick={() => (surface = 'activity')}>✳ <span>Activity</span></button>
                <button role="tab" aria-selected={surface === 'terminal'} class:active={surface === 'terminal'} onclick={openTerminal}>⌘ <span>Terminal</span></button>
                <span class="view-tip">{selected.vendor ? 'Agent session' : 'Direct shell'} · {connected ? 'Live' : 'Offline'}</span>
              </div>

              {#if surface === 'activity'}
                <div class="agent-context">
                  <span class="context-symbol">{selected.vendor === 'claude' ? '✳' : selected.vendor ? '⌘' : '>_'}</span>
                  <div><strong>{agentOf(selected)} is in your pocket.</strong><small>Live activity from the actual session on your Mac.</small></div>
                  <span class="context-live"><span></span> LIVE</span>
                </div>
                <BubbleView sessionId={selected.sessionId} />
              {:else if TerminalView}
                <div class="terminal-body"><TerminalView sessionId={selected.sessionId} /></div>
              {:else}
                <div class="terminal-loading">Loading the real terminal…</div>
              {/if}

              <div class="mobile-quick-actions">
                <span class="actions-label">ONE-TAP ACTIONS</span>
                <div class="quick-row">
                  <button onclick={() => quickAction('summary')}>✳ Progress update <span>↗</span></button>
                  <button onclick={() => quickAction('status')}>⌁ Check status <span>↗</span></button>
                  <button onclick={() => quickAction('review')}>◫ Review changes <span>↗</span></button>
                  <button onclick={() => quickAction('tests')}>✓ {selected.vendor ? 'Run tests' : 'Check working tree'} <span>↗</span></button>
                </div>
              </div>

              <div class="composer-wrap">
                {#if surface === 'terminal'}<KeyboardRow />{/if}
                {#if listening}
                  <div class="voice-listening"><span class="pulse-dot"></span><span>{voiceDraft || 'Listening… speak naturally'}</span><button onclick={startVoice} aria-label="Stop dictation">Finish</button></div>
                {/if}
                <div class="composer">
                  <button class:recording={listening} class="mic-button" aria-label={listening ? 'Finish dictation' : 'Speak a message'} title={speechSupported ? 'Dictate a message' : 'Use keyboard dictation'} onclick={startVoice}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"></path></svg>
                  </button>
                  {#if composerOpen || composer.length > 0}
                    <textarea bind:value={composer} onkeydown={onComposerKey} rows="1" placeholder={selected.vendor ? 'Tell your agent what to do…' : 'Enter a shell command…'} aria-label="Message to Mac"></textarea>
                    <button class="send-button" onclick={send} disabled={!composer.trim()} aria-label="Send message">↑</button>
                  {:else}
                    <button class="compose-trigger" onclick={() => (composerOpen = true)}><span>{selected.vendor ? 'Ask your agent anything…' : 'Type a command, or use voice…'}</span><span class="type-hint">TYPE ↗</span></button>
                  {/if}
                </div>
                <div class="composer-caption">Runs on your Mac · {speechSupported ? 'Speak instead of typing' : 'Use your keyboard microphone for dictation'}{!connected ? ' · offline messages are queued' : ''}</div>
              </div>
            </div>

            <aside class="inspector" aria-label="Session details">
              <div class="inspector-heading"><span>SESSION INSIGHTS</span><span>◌</span></div>
              <div class="inspector-card featured">
                <span>CONNECTED AGENT</span>
                <div class="inspector-agent"><span>{selected.vendor === 'claude' ? '✳' : selected.vendor === 'codex' ? '⌘' : '>_'}</span><strong>{agentOf(selected)}</strong></div>
                <small>{selected.detached ? 'Session detached · process may still be running' : 'Session streaming from your Mac'}</small>
              </div>
              <div class="inspector-card">
                <span>QUICK CONTROLS</span>
                <div class="inspector-actions">
                  <button onclick={() => quickAction('summary')}>✳ <span>Summarise progress</span> ↗</button>
                  <button onclick={() => quickAction('review')}>◫ <span>Review changes</span> ↗</button>
                  <button onclick={() => quickAction('status')}>⌁ <span>Check project status</span> ↗</button>
                  <button onclick={() => quickAction('tests')}>✓ <span>{selected.vendor ? 'Run tests' : 'Check working tree'}</span> ↗</button>
                </div>
              </div>
              <div class="inspector-card">
                <span>SESSION DETAILS</span>
                <div class="inspector-facts"><div><span>Process</span><b>{selected.pid || '—'}</b></div><div><span>Last activity</span><b>{timeAgo(selected.lastActiveAt)}</b></div><div><span>Approvals</span><b>{selected.pendingApprovals}</b></div><div><span>Backing</span><b>{selected.detached ? 'Detached' : 'Terminal'}</b></div></div>
              </div>
              <button class="end-session" onclick={() => {
                if (window.confirm('End this session on your Mac? This may terminate a running process.')) {
                  killSession(selected.sessionId);
                  goHome();
                }
              }}>End this session <span>↗</span></button>
            </aside>
          </div>
        {:else}
          <div class="pick-session">
            <span class="big-glyph">⌘</span>
            <h2>Work starts on your Mac.</h2><p>Choose a running session, or open a fresh terminal without leaving Pocket-T.</p>
            <button class="main-cta" onclick={startSession} disabled={!connected}>New session <span>↗</span></button>
            <div class="pick-list">
              {#each $sessions as s (s.sessionId)}
                <button onclick={() => selectSession(s.sessionId)}>{titleOf(s)} <small>{agentOf(s)}</small> ↗</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {:else if page === 'machine'}
      <div class="content machine-page">
        <div class="topline"><div class="crumb">WORKSPACE <span>/</span> YOUR MAC</div><span class="connection-label"><span class:offline={!connected}></span>{connected ? 'TERMINAL CONNECTED' : 'OFFLINE'}</span></div>
        <div class="machine-hero">
          <span class="hero-eyebrow"><span class="shine"></span> THE NEXT CAPABILITY</span>
          <h1>Beyond the terminal.<br /><em>Your whole Mac.</em></h1>
          <p>Pocket-T already controls real terminal sessions. Visual desktop control will require a permissioned native macOS companion and an encrypted live screen stream. It is not enabled in this build.</p>
          <div class="machine-chips"><span>Window streaming</span><span>Touch & pointer</span><span>Keyboard shortcuts</span><span>Explicit consent</span></div>
        </div>
        <div class="machine-features">
          <div><span class="feature-icon">◩</span><strong>See what the Mac sees</strong><p>Stream an individual window or display when you turn on remote viewing.</p></div>
          <div><span class="feature-icon">⌖</span><strong>Interact naturally</strong><p>Tap, drag and use gestures, with a proper remote keyboard.</p></div>
          <div><span class="feature-icon">✳</span><strong>Let an agent act</strong><p>Ask an on-device agent to work through a UI with explicit permissions and reviewable actions.</p></div>
        </div>
        <div class="machine-footnote"><span>⛨</span> This page is an honest design preview. No screen capture, pointer access or desktop automation has been activated.</div>
        <button class="light-cta" onclick={goHome}>← Back to workspace</button>
      </div>
    {/if}
  </main>

  {#if toast}<div class="toast" role="status">{toast}</div>{/if}
</div>

<style>
  .app{--bg:#090e16;--bg-elev:#101823;--bg-card:#15202d;--border:rgba(192,212,228,.13);--text:#ecf4f5;--text-dim:#91a3ae;--accent:#8ff0c4;--accent-dim:#1c594a;--user:#173c39;--thought:#17212e;--action:#13292a;--result:#142821;--approval:#322b1c;--error:#39222b;--danger:#fa8f96;position:relative;display:flex;height:100dvh;min-height:0;background:#090e16;color:var(--text);overflow:hidden}
  .ambient{position:absolute;pointer-events:none;filter:blur(80px);opacity:.23;z-index:0}
  .ambient-one{top:-260px;right:12%;width:520px;height:360px;background:#176c7b}
  .ambient-two{bottom:-400px;left:20%;width:500px;height:500px;background:#145d48;opacity:.15}
  .rail,.main{position:relative;z-index:1}
  .rail{width:248px;min-width:248px;display:flex;flex-direction:column;background:rgba(11,18,28,.96);border-right:1px solid rgba(160,184,194,.11);padding:28px 14px 18px}
  button{transition:background .18s,border-color .18s,transform .18s,opacity .18s}
  button:focus-visible{outline:2px solid #8ff0c4;outline-offset:2px}
  button:disabled{opacity:.42;cursor:not-allowed}
  .brand{padding:3px 8px 3px 10px;margin-bottom:56px;background:none;border:0;display:flex;align-items:center;gap:13px;color:white;text-align:left}
  .mark{width:35px;height:35px;background:#a3fbd4;color:#0c201b;border-radius:11px;display:grid;place-items:center;box-shadow:0 7px 26px rgba(52,229,177,.11);transform:rotate(-8deg)}
  .mark-inner{font-weight:950;font-size:23px;transform:rotate(8deg);font-family:ui-monospace,Menlo,monospace}
  .brand-text{font-size:20px;font-weight:800;letter-spacing:-1.1px}.brand-dot,.mobile-brand span{color:#9bf4c7}
  .brand-text small{display:block;font-size:8px;font-weight:800;letter-spacing:2.6px;color:#6f9293;margin-top:1px}
  .rail-section-label,.session-rail-header,.section-kicker,.inspector-heading,.inspector-card>span:first-child,.eyebrow,.crumb,.actions-label{font-size:10px;letter-spacing:1.65px;font-weight:800;color:#718995}
  .rail-section-label{padding-left:18px;margin-bottom:14px}
  .primary-nav{display:grid;gap:4px}
  .primary-nav button{border:0;border-radius:10px;background:transparent;display:flex;align-items:center;gap:12px;padding:13px 13px;color:#9baeb7;text-align:left;font-size:13px;font-weight:700;width:100%}
  .primary-nav button:hover,.primary-nav button.active{background:#172630;color:#eaf9f3}
  .primary-nav button.active{box-shadow:inset 3px 0 0 #8ff0c4}
  .nav-icon{font-size:20px;width:19px;text-align:center;line-height:15px;color:#88a4ae}
  .primary-nav button.active .nav-icon{color:#a7f9d6}
  .nav-counter{margin-left:auto;background:#294339;color:#b6fbdc;font-size:10px;padding:2px 7px;border-radius:20px}
  .nav-soon{margin-left:auto;font-size:8px;color:#748c91}
  .session-rail-header{display:flex;align-items:center;justify-content:space-between;margin-top:38px;padding:0 8px 10px 17px}
  .session-rail-header button{border:1px solid #2c403e;background:#142922;color:#9deac4;border-radius:8px;width:28px;height:28px;font-size:18px}
  .session-rail-list{overflow-y:auto;min-height:0;flex:1;display:flex;flex-direction:column;gap:5px;scrollbar-width:thin}
  .rail-session{display:flex;align-items:center;gap:10px;padding:11px 9px;border:1px solid transparent;background:transparent;border-radius:11px;width:100%;text-align:left}
  .rail-session:hover,.rail-session.selected{background:#17262d;border-color:#29443e}
  .session-glyph{height:34px;width:34px;flex:none;border-radius:10px;display:grid;place-items:center;background:#20303b;color:#a8b6ca;font-size:13px;font-weight:800}
  .session-glyph.agent{color:#a2e9cf;background:#1d3839;font-size:19px}
  .session-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:3px}.session-copy strong{color:#e8f0f1;font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.session-copy small{font-size:10px;color:#7e939d}
  .live-dot,.approval-dot,.machine-status{height:7px;width:7px;flex:none;background:#8ff0c4;border-radius:50%;box-shadow:0 0 8px #8ff0c455}.live-dot.off{background:#647586;box-shadow:none}
  .approval-dot{background:#f4c16d;box-shadow:0 0 8px #dba04c55}
  .rail-empty{padding:16px;font-size:12px;line-height:1.7;color:#667e89}
  .rail-bottom{border-top:1px solid #24323d;padding-top:14px;display:grid;gap:19px}
  .notification-option{background:none;border:0;text-align:left;font-size:11px;display:flex;gap:10px;color:#8199a6;padding:5px 10px}.notification-option span:first-child{font-size:16px}.tiny-arrow{margin-left:auto}
  .machine-mini{display:flex;align-items:center;gap:10px;padding:13px 10px;background:#15232d;border:1px solid #283941;border-radius:13px}
  .machine-avatar{background:#273a42;border-radius:9px;width:30px;height:30px;display:grid;place-items:center;font-size:17px}
  .machine-mini div{display:grid;gap:3px;flex:1}.machine-mini strong{font-size:11px}.machine-mini small{font-size:10px;color:#849aa7}.machine-status.offline,.connection-label span.offline,.mobile-presence span.offline{background:#f0a184;box-shadow:none}
  .main{min-width:0;flex:1;display:flex;flex-direction:column;overflow:hidden}
  .content{padding:37px clamp(24px,5vw,72px) 48px;overflow-y:auto;flex:1;max-width:1460px;width:100%;margin:0 auto}
  .topline{display:flex;align-items:center;justify-content:space-between;margin-bottom:45px}.crumb span{margin:0 11px;color:#435966}
  .connection-label{color:#8aa49e;font-size:10px;letter-spacing:1.1px;font-weight:800;display:flex;align-items:center;gap:9px}
  .connection-label span,.mobile-presence span{width:7px;height:7px;display:inline-block;background:#8ff0c4;border-radius:50%;box-shadow:0 0 12px #8ff0c477}
  .hero{position:relative;padding:54px 54px 62px;border:1px solid rgba(126,179,163,.23);border-radius:24px;overflow:hidden;background:radial-gradient(ellipse at 87% 37%,rgba(28,118,100,.42),transparent 45%),linear-gradient(113deg,#172a32 0%,#101c29 48%,#102a2c 100%);min-height:360px}
  .hero:after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,.0) 60%,rgba(10,46,42,.16))}
  .hero-eyebrow{color:#a6e8cf;letter-spacing:2.2px;font-size:10px;font-weight:850;display:flex;align-items:center;gap:10px}
  .shine{display:inline-block;width:6px;height:6px;background:#a6ffcf;border-radius:50%;box-shadow:0 0 16px #9dffd7}
  .hero h1,.machine-hero h1{font-size:clamp(40px,4.7vw,66px);font-weight:760;line-height:1.075;letter-spacing:-3px;margin:23px 0 18px;position:relative;z-index:1}
  .hero h1 em,.machine-hero h1 em{font-weight:550;color:#97e7ca;font-style:normal}
  .hero p,.machine-hero p{max-width:410px;color:#a2bac3;font-size:14px;line-height:1.85;margin:0;position:relative;z-index:1}
  .hero-actions{display:flex;gap:15px;align-items:center;margin-top:30px;position:relative;z-index:2}
  .main-cta{background:#a9f8d2;color:#0e2a25;border:1px solid #b1f7d5;padding:14px 19px;border-radius:10px;font-size:12px;font-weight:850;letter-spacing:.1px}
  .main-cta:hover:not(:disabled){background:#d1ffe9;transform:translateY(-1px)}
  .main-cta span{margin-left:16px;font-size:15px}
  .light-cta{background:transparent;border:0;color:#b4cbd0;padding:12px 5px;font-size:12px;font-weight:700}.light-cta span{margin-left:10px}
  .hero-halo{position:absolute;width:340px;height:340px;right:65px;top:17px;display:grid;place-items:center;opacity:.92}
  .halo-a,.halo-b{position:absolute;border-radius:50%;border:1px solid rgba(151,251,215,.17);height:310px;width:310px}
  .halo-b{width:236px;height:236px;border-style:dashed;border-color:rgba(151,251,215,.38);animation:halo-rotate 45s linear infinite}
  .halo-core{height:142px;width:142px;border-radius:43px;transform:rotate(-8deg);display:grid;place-items:center;background:linear-gradient(135deg,#b4fbdc,#68d6b3);color:#0f463c;font-size:100px;font-family:ui-monospace,Menlo,monospace;font-weight:950;box-shadow:0 30px 75px rgba(59,197,158,.18)}
  @keyframes halo-rotate{to{transform:rotate(360deg)}}
  .stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;margin-top:22px}
  .metric{border:1px solid #25343b;border-radius:15px;padding:21px 23px;background:rgba(19,29,41,.8);display:flex;flex-direction:column;gap:9px}
  .metric>span{font-size:10px;color:#7d929e;font-weight:800;letter-spacing:1.4px}.metric strong{font-size:32px;letter-spacing:-1.5px;font-weight:680}.metric strong.alert{color:#f3bd72}.metric strong.connection-metric{font-size:25px;color:#b2f3d3}.metric small{font-size:11px;color:#7d929d}
  .section-top{display:flex;justify-content:space-between;align-items:end;margin-top:43px;margin-bottom:19px}
  .section-top h2{margin:7px 0 0;font-size:23px;letter-spacing:-.6px;font-weight:650}
  .section-action{padding:11px 15px;font-size:11px;font-weight:800;color:#adf6d6;border:1px solid #325447;border-radius:9px;background:#152c28}
  .workspace-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
  .workspace-card{min-width:0;padding:20px;background:rgba(18,30,40,.8);border:1px solid #253940;border-radius:14px;display:flex;align-items:center;gap:14px;text-align:left}
  .workspace-card:hover{background:#1a3034;border-color:#417765}
  .card-main-icon{width:44px;height:44px;border-radius:12px;background:#23413d;color:#b9f9da;display:grid;place-items:center;font-size:20px}
  .card-info{flex:1;min-width:0;display:grid;gap:6px}.card-info strong{font-size:14px}.card-info small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#8299a4}
  .card-go{font-size:19px;color:#9cbaa9}.card-review{color:#f4c57e;font-size:9px;font-weight:800}
  .empty-card{grid-column:1/-1;display:flex;flex-direction:column;align-items:center;text-align:center;padding:40px 24px;background:#111c27;border:1px dashed #38524c;border-radius:16px}
  .empty-symbol{color:#96d9ba;font-size:32px;margin-bottom:11px}.empty-card strong{font-size:16px}.empty-card p{font-size:12px;max-width:300px;color:#8ea0aa;line-height:1.6}.empty-card button{border:0;background:none;color:#a9f7d5;font-size:12px;font-weight:800;padding:12px}
  .empty-card button span{margin-left:8px}
  .session-page{height:100%;display:flex;flex-direction:column;min-height:0}
  .session-header{padding:27px 36px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(137,166,176,.13)}
  .session-header-main{min-width:0}.eyebrow span{margin:0 7px;color:#536a78}
  .session-heading{display:flex;align-items:center;gap:13px;margin-top:9px}.session-heading h1{font-size:29px;font-weight:650;letter-spacing:-1px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .session-pill{background:#1b3d32;border:1px solid #285644;color:#a5eec8;border-radius:7px;font-size:9px;font-weight:800;padding:5px 7px;letter-spacing:.8px}
  .workspace-path{font-size:11px;color:#8aa0ab;margin-top:7px;max-width:65vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .header-tools{display:flex;align-items:center;gap:13px}.tool-button{width:38px;height:38px;background:#172b29;border:1px solid #335149;border-radius:10px;font-size:24px;color:#a5f9d5}
  .workspace-main{display:flex;flex:1;overflow:hidden;min-height:0}
  .conversation-column{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;background:rgba(10,16,25,.36)}
  .surface-tabs{height:56px;flex:none;padding:0 27px;display:flex;align-items:stretch;gap:8px;border-bottom:1px solid #1e303a}
  .surface-tabs button{background:none;border:0;border-bottom:2px solid transparent;padding:0 17px;font-size:12px;font-weight:700;color:#849aa9}
  .surface-tabs button.active{border-bottom-color:#9ef0c7;color:#c0f9de}
  .view-tip{margin-left:auto;align-self:center;color:#728b95;font-size:10px}
  .agent-context{display:flex;gap:13px;align-items:center;padding:18px 29px;border-bottom:1px solid #20333a;background:rgba(20,47,43,.36)}
  .context-symbol{height:36px;width:36px;border-radius:10px;background:#254a40;color:#b5fbd9;font-size:20px;display:grid;place-items:center;flex:none}
  .agent-context div{min-width:0;display:grid;gap:4px}.agent-context strong{font-size:12px}.agent-context small{color:#83a19f;font-size:10px}.context-live{display:flex;align-items:center;gap:6px;margin-left:auto;white-space:nowrap;font-size:9px;font-weight:850;letter-spacing:1px;color:#a7d9be}
  .context-live span{width:6px;height:6px;border-radius:50%;background:#92f4c0}
  .terminal-body{flex:1;display:flex;min-height:0}.terminal-loading{flex:1;display:grid;place-items:center;color:#88a1a7;font-size:13px}
  .mobile-quick-actions{display:none}
  .composer-wrap{background:#101b24;border-top:1px solid #2d3c45;padding:12px 19px 15px;flex:none}
  .composer{display:flex;align-items:center;gap:12px;background:#1a2a33;border:1px solid #355048;border-radius:15px;padding:7px 8px 7px 10px;min-height:56px}
  .mic-button{border:0;background:#234d40;color:#c3f9dc;border-radius:12px;height:40px;width:40px;flex:none;display:grid;place-items:center}
  .mic-button.recording{background:#b8f9d9;color:#0e4234;animation:recording-pulse 1s infinite}
  .mic-button svg{width:19px;height:19px}
  .compose-trigger{background:none;border:0;display:flex;justify-content:space-between;flex:1;min-width:0;text-align:left;align-items:center;gap:8px;color:#92a7b1;font-size:13px;padding:7px 4px}
  .type-hint{font-size:9px;color:#9dcfbb;letter-spacing:1px;white-space:nowrap}
  .composer textarea{font:inherit;resize:vertical;min-height:38px;max-height:140px;background:none;color:#f0f9f5;border:0;outline:0;flex:1;min-width:0;font-size:15px;line-height:1.5;padding:7px}
  .composer textarea::placeholder{color:#728e98}.send-button{width:38px;height:38px;flex:none;background:#acf9d5;color:#103d31;font-size:22px;border:0;border-radius:10px;font-weight:800}
  .composer-caption{padding:8px 8px 0;text-align:center;font-size:10px;color:#77929a}
  .voice-listening{padding:8px 11px;color:#c5fee2;font-size:12px;display:flex;align-items:center;gap:10px}.voice-listening span:nth-child(2){flex:1}.voice-listening button{border:0;background:#234f41;color:#b8f9d7;border-radius:6px;padding:6px 10px}
  .pulse-dot{height:9px;width:9px;border-radius:50%;background:#b8f9d7;animation:recording-pulse 1s infinite}
  @keyframes recording-pulse{50%{opacity:.3}}
  .inspector{width:278px;flex:none;background:rgba(15,24,32,.9);border-left:1px solid #22313c;padding:26px 17px;overflow-y:auto}
  .inspector-heading{display:flex;justify-content:space-between;margin:2px 3px 18px}
  .inspector-card{border:1px solid #293e41;background:#14232c;border-radius:13px;padding:18px;margin-bottom:12px}
  .inspector-card.featured{background:linear-gradient(145deg,#183d3a,#14272c);border-color:#355e53}
  .inspector-card>span:first-child{font-size:9px;color:#81a7a1;letter-spacing:1.35px}
  .inspector-agent{display:flex;gap:10px;align-items:center;margin:17px 0}.inspector-agent span{font-size:30px;color:#b2f4cf}.inspector-agent strong{font-size:18px}
  .inspector-card small{color:#8fa8a8;font-size:11px;line-height:1.65}
  .inspector-actions{display:grid;margin-top:12px;gap:2px}
  .inspector-actions button{border:0;background:none;padding:10px 3px;text-align:left;display:flex;align-items:center;gap:10px;font-size:13px;color:#a9e4ca}
  .inspector-actions button:hover{color:#e4ffec}.inspector-actions button span{color:#c7d8d6;flex:1;font-size:11px}
  .inspector-facts{margin-top:14px;display:grid;gap:12px}.inspector-facts div{display:flex;justify-content:space-between;gap:15px;font-size:11px}.inspector-facts span{color:#8298a1}.inspector-facts b{font-weight:550;color:#d4e4e2}
  .end-session{border:0;background:none;color:#b88e95;padding:12px 5px;font-size:11px;font-weight:700;display:flex;width:100%;justify-content:space-between}
  .pick-session{margin:auto;text-align:center;max-width:400px;padding:40px 20px}.big-glyph{font-size:64px;color:#9cebc9}.pick-session h2{font-size:24px}.pick-session p{color:#8aa2ae;font-size:13px;line-height:1.7}.pick-list{display:grid;gap:7px;margin-top:22px}.pick-list button{border:1px solid #28443d;background:#14292b;padding:12px;border-radius:10px;display:flex;gap:12px;justify-content:space-between;text-align:left}.pick-list small{color:#8ca59d}
  .machine-page{padding-top:37px}.machine-hero{padding:52px;background:linear-gradient(124deg,#193b3b,#101e2a 58%,#131e2a);border:1px solid #35524c;border-radius:22px}
  .machine-hero h1{font-size:clamp(37px,5vw,62px)}.machine-hero p{max-width:570px}.machine-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:30px}.machine-chips span{padding:9px 12px;font-size:10px;color:#b3e6d3;border:1px solid #406458;border-radius:99px;background:#1f403b}
  .machine-features{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:22px 0}.machine-features>div{padding:27px;border:1px solid #293f46;border-radius:15px;background:#15232d}.feature-icon{color:#a9f6d3;font-size:25px;display:block;margin-bottom:20px}.machine-features strong{display:block;font-size:15px}.machine-features p{color:#8a9fa8;font-size:12px;line-height:1.7}
  .machine-footnote{display:flex;gap:12px;align-items:center;color:#b4a8a1;font-size:12px;margin:20px 0}.machine-footnote span{font-size:20px}
  .mobile-top{display:none}.mobile-scrim{display:none}
  .toast{position:fixed;bottom:35px;left:50%;transform:translateX(-50%);background:#b7f9da;color:#123e32;padding:12px 19px;border-radius:11px;z-index:50;font-size:12px;font-weight:800;box-shadow:0 14px 50px #0009;white-space:nowrap}
  @media(max-width:1160px){.inspector{display:none}.hero-halo{right:-18px;opacity:.63}.hero{padding:47px 40px}}
  @media(max-width:760px){
    .app{height:100dvh;display:block;padding-bottom:0}
    .rail{position:fixed;inset:0 auto 0 0;z-index:30;width:min(82vw,310px);min-width:0;transform:translateX(-101%);transition:transform .25s;padding-top:calc(var(--safe-top) + 23px)}.rail.mobile-open{transform:translateX(0)}
    .mobile-scrim{display:block;position:fixed;inset:0;z-index:29;background:#000b;border:0}
    .main{height:100%;width:100%}.mobile-top{height:calc(60px + var(--safe-top));padding:var(--safe-top) 18px 0;flex:none;border-bottom:1px solid #23333b;display:flex;align-items:center;justify-content:space-between;background:#101a24}
    .mobile-menu-button{font-size:19px;border:0;background:none;color:#c9dedc;width:42px;height:38px;text-align:left}
    .mobile-brand{font-size:21px;letter-spacing:-1.1px;font-weight:800}.mobile-presence{display:flex;align-items:center;gap:6px;font-size:9px;color:#a2c8b1;letter-spacing:1px;font-weight:800}
    .content{padding:23px 18px 40px}.topline{margin-bottom:22px}.crumb{font-size:9px}.connection-label{font-size:8px;letter-spacing:.5px}
    .hero{padding:31px 24px 30px;min-height:330px;border-radius:19px}.hero h1{font-size:44px;letter-spacing:-2.3px;margin:22px 0 12px}.hero p{font-size:12px;line-height:1.7;max-width:280px}.hero-halo{width:230px;height:230px;right:-112px;top:45px;opacity:.22}.halo-a{width:230px;height:230px}.halo-b{width:165px;height:165px}.halo-core{width:90px;height:90px;font-size:65px;border-radius:26px}
    .hero-actions{margin-top:22px;flex-wrap:wrap;gap:9px}.main-cta{padding:13px 14px;font-size:11px}.light-cta{font-size:11px}
    .stats-grid{gap:8px;margin-top:12px}.metric{padding:15px 12px;border-radius:13px;min-width:0}.metric>span{font-size:8px;line-height:1.4;letter-spacing:.65px}.metric strong{font-size:26px}.metric strong.connection-metric{font-size:18px}.metric small{font-size:9px;line-height:1.3}
    .section-top{margin-top:31px}.section-top h2{font-size:21px}.section-action{font-size:10px;padding:9px}
    .workspace-cards{grid-template-columns:1fr;gap:9px}.workspace-card{padding:15px}.card-main-icon{width:40px;height:40px}
    .session-header{padding:18px 18px 16px}.session-heading{margin-top:6px}.session-heading h1{font-size:24px}.workspace-path{max-width:70vw;font-size:10px}.eyebrow{font-size:8px;letter-spacing:1px}.header-tools{gap:6px}
    .surface-tabs{height:48px;padding:0 11px}.surface-tabs button{font-size:11px;padding:0 14px}.view-tip{font-size:9px}
    .agent-context{padding:12px 17px;gap:10px}.context-symbol{height:31px;width:31px}.agent-context strong{font-size:11px}.agent-context small{font-size:9px}.context-live{font-size:8px}
    .mobile-quick-actions{display:block;background:#111d26;padding:10px 0 8px;border-top:1px solid #263840}
    .actions-label{display:block;padding:0 17px 8px;font-size:8px}
    .quick-row{display:flex;gap:7px;overflow-x:auto;padding:0 16px 4px;scrollbar-width:none}.quick-row::-webkit-scrollbar{display:none}
    .quick-row button{flex:none;display:flex;align-items:center;gap:10px;padding:12px 13px;background:#1c3432;border:1px solid #31534b;border-radius:10px;font-size:10px;color:#c1ead8;font-weight:750}
    .quick-row button span{font-size:12px;color:#7eaca0}
    .composer-wrap{padding:9px 11px calc(var(--safe-bottom) + 11px)}.composer{border-radius:13px;min-height:53px}.composer-caption{font-size:9px;padding-top:6px}
    .mic-button{width:38px;height:38px}.compose-trigger{font-size:12px}
    .machine-hero{padding:33px 25px}.machine-hero h1{font-size:42px;letter-spacing:-2px}.machine-hero p{font-size:12px}.machine-features{grid-template-columns:1fr;gap:9px}.machine-features>div{padding:19px}.feature-icon{margin-bottom:10px}
    .toast{bottom:calc(var(--safe-bottom) + 105px);max-width:90vw;white-space:normal;text-align:center}
  }
  @media(min-width:761px){.home-content{padding-bottom:70px}}
  @media(prefers-reduced-motion:reduce){.halo-b,.mic-button.recording,.pulse-dot{animation:none}}
</style>
