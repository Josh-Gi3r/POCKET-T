<script lang="ts">
  import { onMount, tick } from 'svelte';
  import TerminalView from './TerminalView.svelte';
  import KeyboardRow from './KeyboardRow.svelte';
  import BubbleView from './BubbleView.svelte';
  import {
    status, sessions, current, existingTerminals, joinState, spawnState,
    conn, attach, spawnSession, discoverExistingTerminals, joinExistingTmux,
  } from '../lib/store';
  import type { ExistingTerminal, SessionInfo } from '../lib/types';

  type View = 'terminal' | 'activity';
  type KeyboardMode = 'compose' | 'direct';
  type TerminalControls = {
    focusTerminal(): void;
    copySelection(): Promise<boolean>;
    clearLocalScreen(): void;
  };

  let showSessions = $state(false);
  let discoverStarted = $state(false);
  let sessionFilter = $state('');
  let view = $state<View>('terminal');
  let keyboardMode = $state<KeyboardMode>('compose');
  let fontSize = $state(14);
  let draftBySession = $state<Record<string, string>>({});
  let multilineConfirmed = $state(false);
  let fullScreen = $state(false);
  let notice = $state('');
  let terminalRef = $state<TerminalControls | undefined>(undefined);
  let draftInput = $state<HTMLTextAreaElement | undefined>(undefined);

  const online = $derived($status === 'open');
  const selected = $derived($sessions.find((s) => s.sessionId === $current) ?? null);
  const activeId = $derived($current ?? '');
  const draft = $derived(draftBySession[activeId] ?? '');
  const hasMultiline = $derived(/\r|\n/.test(draft));
  const managed = $derived($sessions.filter((s) =>
    !sessionFilter || (displayName(s) + ' ' + s.cwd).toLowerCase().includes(sessionFilter.toLowerCase())));
  const discovered = $derived($existingTerminals.filter((s) =>
    !sessionFilter || (s.title + ' ' + s.source).toLowerCase().includes(sessionFilter.toLowerCase())));

  function displayName(s: SessionInfo): string {
    const name = s.cwd.split('/').filter(Boolean).pop();
    return name || 'Shell';
  }

  function vendorName(s: SessionInfo): string {
    if (s.sessionId.startsWith('join-')) return 'Joined tmux';
    if (s.vendor === 'claude') return 'Claude Code';
    if (s.vendor === 'codex') return 'Codex';
    return s.vendor ? s.vendor[0]!.toUpperCase() + s.vendor.slice(1) : 'Live shell';
  }

  function signal(message: string): void {
    notice = message;
    window.setTimeout(() => { if (notice === message) notice = ''; }, 3000);
  }

  function chooseSession(id: string): void {
    attach(id);
    view = 'terminal';
    multilineConfirmed = false;
    showSessions = false;
  }

  function chooseView(next: View): void {
    view = next;
    if (next === 'terminal' && keyboardMode === 'direct') {
      void tick().then(() => terminalRef?.focusTerminal());
    }
  }

  function newSession(): void {
    if (!online) {
      signal('Your Mac is offline.');
      return;
    }
    if ($spawnState.status === 'starting') return;
    spawnSession();
    showSessions = false;
    signal('Starting a real shell on your Mac…');
  }

  function discover(): void {
    if (!online) return;
    discoverStarted = true;
    discoverExistingTerminals();
  }

  function joinExisting(session: ExistingTerminal): void {
    if (!online || session.source !== 'tmux' || !session.capabilities.includes('join')) return;
    joinExistingTmux(session.sessionId);
  }

  function setDraft(value: string): void {
    if (!$current) return;
    draftBySession[$current] = value;
    multilineConfirmed = false;
  }

  function sendDraft(): void {
    if (!online || !selected || selected.detached) {
      signal('Disconnected. Your draft has been kept.');
      return;
    }
    if (!draft.trim()) return;
    if (hasMultiline && !multilineConfirmed) {
      multilineConfirmed = true;
      signal('Review the multiple commands before confirming.');
      return;
    }
    const value = draft.replace(/\r\n?/g, '\n');
    // A standard line sends Enter; an explicitly confirmed multiline
    // draft sends the exact lines, each newline interpreted by the PTY.
    const bytes = value + '\r';
    if (conn.sendInput(bytes)) {
      draftBySession[activeId] = '';
      multilineConfirmed = false;
      signal('Sent to your live terminal');
    } else {
      signal('Connection lost; draft preserved.');
    }
  }

  function onDraftKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendDraft();
    }
  }

  function focusDirect(): void {
    keyboardMode = 'direct';
    view = 'terminal';
    void tick().then(() => terminalRef?.focusTerminal());
  }

  function focusCompose(): void {
    keyboardMode = 'compose';
    void tick().then(() => draftInput?.focus());
  }

  async function copySelection(): Promise<void> {
    const success = await terminalRef?.copySelection();
    signal(success ? 'Selected terminal text copied' : 'Select text in the terminal first');
  }

  function stageMultilinePaste(text: string): void {
    setDraft(draft + text);
    focusCompose();
    signal('Multiple lines staged for your review — nothing was executed');
  }

  async function pasteDraft(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setDraft(draft + text);
        focusCompose();
        signal(/\n/.test(text) ? 'Multiline paste staged for review' : 'Pasted to draft');
      }
    } catch { signal('Use the system Paste option on your keyboard'); }
  }

  function adjustFont(delta: number): void {
    fontSize = Math.max(11, Math.min(22, fontSize + delta));
    try { localStorage.setItem('pt-font-size', String(fontSize)); } catch { /* best effort */ }
  }

  function toggleFullscreen(): void {
    fullScreen = !fullScreen;
    if (fullScreen) {
      view = 'terminal';
      void tick().then(() => terminalRef?.focusTerminal());
    }
  }

  onMount(() => {
    try {
      const stored = Number(localStorage.getItem('pt-font-size'));
      if (Number.isFinite(stored) && stored >= 11 && stored <= 22) fontSize = stored;
    } catch { /* private browsing */ }
  });
</script>

<div class="term-page" class:immersive={fullScreen}>
  <aside class="session-column" aria-label="Live terminal sessions">
    <div class="column-title">
      <div><span class="eyebrow">YOUR MACHINE</span><h2>Terminals <span class="count">{$sessions.length}</span></h2></div>
      <button class="new-shell" onclick={newSession} disabled={!online} aria-label="Open new terminal">＋</button>
    </div>
    <div class="search-container">
      <span>⌕</span>
      <input type="search" placeholder="Find a session" aria-label="Search terminal sessions" bind:value={sessionFilter} />
    </div>
    <div class="session-scroll">
      <div class="group-label">LIVE SESSIONS</div>
      {#each managed as s (s.sessionId)}
        <button
          class:chosen={$current === s.sessionId}
          class="session"
          onclick={() => chooseSession(s.sessionId)}
        >
          <span class="session-icon" class:agent={!!s.vendor}>{s.vendor === 'claude' ? '✳' : s.vendor === 'codex' ? '◇' : '>_'}</span>
          <span class="session-info"><strong>{displayName(s)}</strong><small>{vendorName(s)} · {s.detached ? 'Detached' : 'Running'}</small></span>
          <span class:idle={s.detached} class="session-led"></span>
        </button>
      {/each}
      {#if !managed.length}
        <div class="list-empty">No managed sessions yet.<br/>Create one or discover what is already running.</div>
      {/if}
      <div class="discover-heading">
        <span class="group-label">ALREADY OPEN ON MAC</span>
        <button onclick={discover} disabled={!online} aria-label="Scan existing terminals">↻ Scan</button>
      </div>
      {#each discovered as ext (ext.sessionId)}
        <div class="external">
          <span class="external-icon">{ext.source === 'tmux' ? '⊞' : '⌘'}</span>
          <span class="external-info"><strong>{ext.title}</strong><small>{ext.source === 'tmux' ? 'tmux session' : ext.source === 'iterm2' ? 'iTerm2' : 'Terminal.app'}</small></span>
          {#if ext.source === 'tmux' && ext.capabilities.includes('join')}
            <button class="join" onclick={() => joinExisting(ext)} disabled={!online || $joinState.status === 'joining'}>Join</button>
          {:else}
            <span class="observe">Listed</span>
          {/if}
        </div>
      {/each}
      {#if discoverStarted && !discovered.length}
        <div class="list-empty">No other terminals discovered, or macOS denied discovery permissions.</div>
      {/if}
      {#if $spawnState.status === 'starting'}<div class="join-feedback">Starting your new shell…</div>{/if}
      {#if $spawnState.status === 'error'}<div class="join-error">{$spawnState.message}</div>{/if}
      {#if $joinState.status === 'joining'}<div class="join-feedback">Joining the existing tmux session…</div>{/if}
      {#if $joinState.status === 'error'}<div class="join-error">{$joinState.message}</div>{/if}
    </div>
    <div class="sidebar-footer">
      <span class="machine-dot" class:offline={!online}></span>
      <div><strong>Local Mac</strong><small>{online ? 'Connected securely' : $status === 'reconnecting' ? 'Reconnecting' : 'Offline'}</small></div>
      <span class="sidebar-device">⌘</span>
    </div>
  </aside>

  <section class="terminal-stage">
    <header class="stage-header">
      <button class="mobile-sessions" onclick={() => (showSessions = true)} aria-label="Choose terminal session">
        <span class="session-lines">☷</span>
        <span class="mobile-title">{selected ? displayName(selected) : 'Your terminals'}</span>
        <span class="dropdown-indicator">⌄</span>
      </button>
      <div class="stage-title">
        <div class="crumb">POCKET-T <span> / </span> LIVE TERMINAL</div>
        <div class="stage-title-row"><h1>{selected ? displayName(selected) : 'Your terminals'}</h1>
          {#if selected}<span class:off={selected.detached} class="status-pill"><span></span>{selected.detached ? 'DETACHED' : 'LIVE SESSION'}</span>{/if}
        </div>
        <p>{selected?.cwd ?? 'Connect to a real shell on your Mac — no AI needed.'}</p>
      </div>
      <div class="stage-actions">
        <span class="status-connection" class:offline={!online}><span></span>{online ? 'CONNECTED' : 'OFFLINE'}</span>
        <button class="icon-action" onclick={() => adjustFont(-1)} aria-label="Decrease terminal font" title="Smaller text">A−</button>
        <button class="icon-action" onclick={() => adjustFont(1)} aria-label="Increase terminal font" title="Larger text">A+</button>
        <button class="icon-action full-toggle" onclick={toggleFullscreen} aria-label={fullScreen ? 'Exit immersive terminal' : 'Immersive terminal'} title="Expand terminal">{fullScreen ? '↙' : '⤢'}</button>
      </div>
    </header>

    {#if selected}
      <div class="terminal-layout">
        {#if !fullScreen}
          <div class="terminal-tabs" role="tablist" aria-label="Session views">
            <button class:tab-active={view === 'terminal'} role="tab" aria-selected={view === 'terminal'} onclick={() => chooseView('terminal')}>▣ Terminal</button>
            {#if selected.vendor}
              <button class:tab-active={view === 'activity'} role="tab" aria-selected={view === 'activity'} onclick={() => chooseView('activity')}>✳ Activity</button>
            {/if}
            <span class="shell-capability">{selected.sessionId.startsWith('join-') ? 'ATTACHED TO EXISTING TMUX' : 'REAL PTY'} <span>·</span> {selected.rows} × {selected.cols}</span>
          </div>
        {/if}

        <div class="console" class:with-activity={view === 'activity'}>
          {#if fullScreen}
            <button class="immersive-exit" onclick={toggleFullscreen} aria-label="Exit immersive terminal">↙ Exit focus</button>
          {/if}
          <div class="terminal-dots"><i></i><i></i><i></i><span>{selected.shell.split('/').pop() ?? 'shell'} · {selected.sessionId.slice(0, 8)}</span></div>
          {#if view === 'terminal'}
            {#key selected.sessionId}
              <TerminalView bind:this={terminalRef} sessionId={selected.sessionId} {fontSize} interactive={online && !selected.detached} onMultilinePaste={stageMultilinePaste} />
            {/key}
          {:else}
            <div class="activity-wrapper"><BubbleView sessionId={selected.sessionId} /></div>
          {/if}
          {#if !online || selected.detached}
            <div class="connection-overlay"><span class="connection-symbol">⌁</span><strong>{!online ? 'Connection interrupted' : 'Session detached'}</strong><p>{!online ? 'Your terminal remains on your Mac. Commands are not queued or replayed.' : 'The terminal is not currently accepting input.'}</p></div>
          {/if}
        </div>

        <div class="control-dock">
          <div class="quick-control-header">
            <span class="quick-caption">TERMINAL CONTROLS</span>
            <div class="quick-actions">
              <button onclick={() => void copySelection()} disabled={view !== 'terminal'} title="Copy selected terminal text">Copy</button>
              <button onclick={() => void pasteDraft()} disabled={!online} title="Paste clipboard into editable draft">Paste</button>
              <button onclick={focusDirect} class:mode-active={keyboardMode === 'direct'} disabled={!online || selected.detached || view !== 'terminal'}>Direct keys</button>
              <button onclick={focusCompose} class:mode-active={keyboardMode === 'compose'}>Compose</button>
            </div>
          </div>
          <KeyboardRow disabled={!online || selected.detached} />
          <div class="compose-row">
            <span class="prompt-glyph">❯</span>
            <textarea
              bind:this={draftInput}
              rows="1"
              value={draft}
              oninput={(event) => setDraft(event.currentTarget.value)}
              onkeydown={onDraftKey}
              placeholder={online ? 'Type a command, or tap Direct keys…' : 'Offline — draft stays on this device'}
              aria-label="Compose input for the selected live terminal"
              enterkeyhint="send"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="off"
            ></textarea>
            <button
              class="send-command"
              class:confirm={hasMultiline && multilineConfirmed}
              onclick={sendDraft}
              disabled={!online || selected.detached || !draft.trim()}
              aria-label={hasMultiline && !multilineConfirmed ? 'Review multiline command' : 'Send to terminal'}
              title={hasMultiline && !multilineConfirmed ? 'Review multiple lines' : 'Send to live PTY'}
            >{hasMultiline && !multilineConfirmed ? 'Review' : hasMultiline ? 'Confirm' : '↵'}</button>
          </div>
          <div class="dock-footer">
            <span><span class="safe-dot"></span>{online ? 'Input goes directly to your Mac. No model or tokens required.' : 'Offline input will not auto-send.'}</span>
            <span class="mode-label">{keyboardMode === 'direct' ? 'DIRECT PTY' : 'EDITABLE DRAFT'}</span>
          </div>
        </div>
      </div>
    {:else}
      <div class="empty-main">
        <div class="empty-emblem"><span>❯_</span></div>
        <span class="eyebrow">YOUR TERMINAL, ANYWHERE</span>
        <h2>Pick up exactly<br/>where you left off.</h2>
        <p>Open a real shell or join an existing tmux session. No AI, no token limits, no simulated terminal.</p>
        <button class="new-primary" onclick={newSession} disabled={!online || $spawnState.status === 'starting'}>＋ {$spawnState.status === 'starting' ? 'Starting…' : 'New terminal'}</button>
        {#if $spawnState.status === 'error'}<div class="join-error">{$spawnState.message}</div>{/if}
        <button class="secondary-discover" onclick={() => { showSessions = true; discover(); }} disabled={!online}>Discover existing sessions →</button>
      </div>
    {/if}
  </section>

  {#if showSessions}
    <button class="sheet-backdrop" aria-label="Close session selector" onclick={() => (showSessions = false)}></button>
    <div class="mobile-sheet" role="dialog" aria-label="Choose a terminal">
      <div class="sheet-handle"></div>
      <div class="sheet-header"><h2>My terminals</h2><button onclick={() => (showSessions = false)} aria-label="Close">✕</button></div>
      <button class="sheet-new" onclick={newSession} disabled={!online}>＋ New terminal</button>
      <div class="sheet-scroll">
        <div class="group-label">LIVE TERMINALS</div>
        {#each $sessions as s (s.sessionId)}
          <button class="sheet-session" onclick={() => chooseSession(s.sessionId)}>
            <span class="session-icon">{s.vendor === 'claude' ? '✳' : '>_'}</span>
            <span><strong>{displayName(s)}</strong><small>{vendorName(s)} · {s.detached ? 'Detached' : 'Running'}</small></span>
            <span class="sheet-arrow">↗</span>
          </button>
        {/each}
        <div class="discover-heading"><span class="group-label">ALREADY OPEN</span><button onclick={discover} disabled={!online}>↻ Scan</button></div>
        {#each $existingTerminals as ext (ext.sessionId)}
          <div class="sheet-session">
            <span class="session-icon">⌘</span>
            <span><strong>{ext.title}</strong><small>{ext.source === 'tmux' ? 'tmux' : ext.source} · {ext.capabilities.includes('join') ? 'Can join' : 'Discovery only'}</small></span>
            {#if ext.source === 'tmux' && ext.capabilities.includes('join')}
              <button class="join" disabled={!online || $joinState.status === 'joining'} onclick={() => joinExisting(ext)}>Join</button>
            {/if}
          </div>
        {/each}
        {#if $spawnState.status === 'starting'}<div class="join-feedback">Starting a real terminal…</div>{/if}
      {#if $spawnState.status === 'error'}<div class="join-error">{$spawnState.message}</div>{/if}
      {#if $joinState.status === 'joining'}<div class="join-feedback">Attaching to existing tmux…</div>{/if}
        {#if $joinState.status === 'error'}<div class="join-error">{$joinState.message}</div>{/if}
      </div>
    </div>
  {/if}
  {#if notice}<div class="toast" role="status">{notice}</div>{/if}
</div>

<style>
  .term-page{display:flex;flex:1;min-width:0;min-height:0;height:100%;background:#0a111b;color:#e5eef1;overflow:hidden;--line:#253544;--subtle:#839aa8;--accent:#a6efcc}
  button{cursor:pointer;font-family:inherit}
  button:disabled{cursor:not-allowed;opacity:.36}
  button:focus-visible{outline:2px solid #a6efcc;outline-offset:2px}
  .session-column{width:255px;flex:none;min-height:0;display:flex;flex-direction:column;background:#111c29;border-right:1px solid #283643}
  .column-title{display:flex;align-items:center;justify-content:space-between;padding:26px 20px 15px}
  .eyebrow,.group-label,.quick-caption,.crumb{font-size:9px;letter-spacing:1.6px;font-weight:800;color:#7998a3}
  .column-title h2{font-size:18px;letter-spacing:-.5px;font-weight:700;margin:8px 0 0}.count{font-size:11px;color:#9baeb8;margin-left:8px}
  .new-shell{border:1px solid #467469;background:#20413d;color:#b6f9d9;width:34px;height:34px;font-size:23px;border-radius:10px}
  .search-container{display:flex;align-items:center;gap:9px;background:#182734;border:1px solid #2b4150;margin:2px 14px 19px;border-radius:10px;padding:10px 11px}
  .search-container span{font-size:20px;color:#90b3af}.search-container input{background:none;border:0;outline:none;color:white;min-width:0;flex:1;font-size:12px}
  .search-container input::placeholder{color:#768d9b}
  .session-scroll{flex:1;overflow-y:auto;padding:0 10px;scrollbar-color:#324653 transparent;scrollbar-width:thin}
  .group-label{display:block;margin:0 10px 12px}
  .session,.external{width:100%;display:flex;align-items:center;gap:11px;padding:11px 9px;background:none;border:1px solid transparent;color:inherit;text-align:left;border-radius:12px}
  .session:hover,.session.chosen{background:#1d3239;border-color:#36574c}
  .session-icon,.external-icon{display:grid;place-items:center;flex:none;width:34px;height:36px;border-radius:10px;font:700 12px ui-monospace,Menlo,monospace;color:#b9d6e0;background:#203443}
  .session-icon.agent{color:#aaf5d5;background:#26483f;font-size:18px}
  .session-info,.external-info{min-width:0;flex:1;display:flex;flex-direction:column;gap:4px}
  .session-info strong,.external-info strong{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .session-info small,.external-info small{color:#879fad;font-size:10px}
  .session-led,.machine-dot{height:7px;width:7px;border-radius:50%;background:#98edc7;box-shadow:0 0 10px #a9f6cf77;flex:none}
  .session-led.idle,.machine-dot.offline{background:#a98575;box-shadow:none}
  .discover-heading{display:flex;justify-content:space-between;align-items:center;margin:26px 8px 7px}
  .discover-heading .group-label{margin:0}
  .discover-heading button{border:0;background:none;color:#a6e8ca;font-weight:700;font-size:11px}
  .external{padding:9px;gap:8px}
  .external-icon{font-size:17px;background:#2a3744;color:#aebcca}
  .external-info strong{max-width:128px}.join{background:#1b3e35;color:#baf3d5;border:1px solid #3d6857;border-radius:8px;padding:8px 10px;font-size:11px;font-weight:750}
  .observe{font-size:9px;color:#758f99}
  .list-empty{color:#6e8896;font-size:11px;line-height:1.6;padding:13px 10px 17px}
  .join-feedback,.join-error{font-size:11px;color:#b9edcd;background:#204039;padding:11px;border-radius:9px;line-height:1.5;margin:10px}
  .join-error{background:#3c282a;color:#f5c1bb}
  .sidebar-footer{display:flex;align-items:center;gap:12px;border-top:1px solid #2b3a45;padding:18px}.sidebar-footer div{display:flex;flex-direction:column;gap:4px;flex:1}.sidebar-footer strong{font-size:12px}.sidebar-footer small{font-size:10px;color:#8ea3ae}.sidebar-device{font-size:19px;color:#93b8b7}
  .terminal-stage{min-height:0;min-width:0;display:flex;flex-direction:column;flex:1;background:#0d1723}
  .stage-header{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:22px 25px;border-bottom:1px solid #233443;min-height:107px;background:#111c29}
  .stage-title{min-width:0}.crumb{margin-bottom:10px}.crumb span{color:#476475;margin:0 7px}.stage-title-row{display:flex;align-items:center;gap:13px}
  .stage-title h1{font-size:24px;letter-spacing:-.8px;margin:0;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .stage-title p{color:#879ea9;font-size:11px;white-space:nowrap;max-width:47vw;overflow:hidden;text-overflow:ellipsis;margin:7px 0 0}
  .status-pill{display:flex;align-items:center;gap:6px;border:1px solid #3d6658;background:#1d382f;color:#bbf9db;font-size:9px;letter-spacing:.9px;padding:6px 10px;border-radius:50px;font-weight:800;white-space:nowrap}
  .status-pill span{width:6px;height:6px;background:#9ef5cb;border-radius:50%}.status-pill.off{color:#e0b9a6;border-color:#6f564d;background:#352724}.status-pill.off span{background:#cba092}
  .stage-actions{display:flex;gap:7px;align-items:center}
  .icon-action{color:#b5cbd1;background:#1d2d3c;border:1px solid #304456;border-radius:9px;min-width:36px;height:36px;padding:0 10px;font-size:12px;font-weight:800}
  .status-connection{color:#b1d8c5;white-space:nowrap;display:flex;align-items:center;gap:6px;font-size:9px;font-weight:800;letter-spacing:1px;margin-right:8px}
  .status-connection span{background:#90e9bd;width:7px;height:7px;border-radius:50%}.status-connection.offline span{background:#d6a090}
  .terminal-layout{display:flex;flex:1;min-height:0;flex-direction:column}
  .terminal-tabs{display:flex;align-items:center;gap:5px;flex:none;border-bottom:1px solid #2b3d48;padding:0 19px;background:#101b28;height:43px}
  .terminal-tabs button{align-self:stretch;font-size:11px;padding:0 15px;font-weight:700;color:#8197a6;background:none;border:0;border-bottom:2px solid transparent}
  .terminal-tabs button.tab-active{color:#b4f4d1;border-bottom-color:#a0f5ce}
  .shell-capability{color:#708f9b;font-size:9px;letter-spacing:.7px;font-weight:700;margin-left:auto}
  .shell-capability span{color:#405660;padding:0 5px}
  .console{min-height:0;flex:1;display:flex;flex-direction:column;position:relative;border:1px solid #314354;border-radius:13px 13px 0 0;margin:12px 14px 0;overflow:hidden;background:#0b1019}
  .terminal-dots{flex:none;height:31px;background:#152333;border-bottom:1px solid #263747;display:flex;align-items:center;gap:6px;padding:0 12px}
  .terminal-dots i{width:7px;height:7px;border-radius:50%;background:#e9878b}.terminal-dots i:nth-child(2){background:#edc778}.terminal-dots i:nth-child(3){background:#79ca9b}
  .terminal-dots span{font-size:9px;letter-spacing:.7px;margin-left:auto;color:#8a9bab;font-family:ui-monospace,Menlo,monospace}
  .activity-wrapper{display:flex;min-height:0;flex:1}
  .connection-overlay{position:absolute;inset:31px 0 0;background:rgba(7,15,23,.88);z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:28px}
  .connection-symbol{font-size:39px;color:#c9a69d;margin-bottom:10px}.connection-overlay strong{font-size:17px}.connection-overlay p{color:#92a5ad;font-size:12px;line-height:1.7;max-width:300px}
  .control-dock{flex:none;background:#111c29;border-top:1px solid #2e4450;padding-bottom:env(safe-area-inset-bottom, 0px)}
  .quick-control-header{display:flex;align-items:center;justify-content:space-between;padding:8px 16px 3px;gap:8px}
  .quick-caption{white-space:nowrap}.quick-actions{display:flex;align-items:center;gap:3px;overflow-x:auto}
  .quick-actions button{background:none;border:0;color:#93adb9;padding:8px 9px;font-size:10px;font-weight:700;white-space:nowrap;border-radius:8px}
  .quick-actions button.mode-active{background:#23433c;color:#bdf6d6}
  .compose-row{display:flex;align-items:center;gap:9px;margin:7px 13px 0;padding:8px;background:#1a2a39;border:1px solid #385356;border-radius:13px}
  .prompt-glyph{font-size:20px;color:#98edc5;margin-left:7px}
  .compose-row textarea{flex:1;min-width:0;max-height:105px;min-height:28px;resize:vertical;padding:3px 0;background:none;border:0;outline:none;color:#e8f6f0;font-size:15px;line-height:1.45;font-family:ui-monospace,Menlo,Consolas,monospace}
  .compose-row textarea::placeholder{color:#7c99a2}.send-command{min-width:41px;height:39px;background:#a5f6cf;color:#123d32;border:0;border-radius:10px;font-size:20px;font-weight:850;padding:0 11px}
  .send-command.confirm{min-width:74px;font-size:12px;background:#e4d195;color:#4b391c}
  .dock-footer{display:flex;justify-content:space-between;gap:10px;padding:8px 18px 11px;color:#7f9ca6;font-size:10px}
  .dock-footer>span{display:flex;align-items:center;gap:7px}.safe-dot{width:6px;height:6px;border-radius:50%;background:#7ec89d}.mode-label{letter-spacing:.7px;font-size:9px;font-weight:750;white-space:nowrap}
  .empty-main{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;padding:25px;text-align:center;background:radial-gradient(ellipse at center,#21453d33,transparent 62%)}
  .empty-emblem{display:grid;place-items:center;width:100px;height:100px;border-radius:26px;background:#203d3b;border:1px solid #43645b;color:#b3f8d7;font-family:ui-monospace,Menlo,monospace;font-size:34px;margin-bottom:30px;transform:rotate(-3deg)}
  .empty-emblem span{transform:rotate(3deg)}.empty-main h2{font-size:clamp(32px,3.2vw,48px);letter-spacing:-1.8px;line-height:1.15;margin:14px 0}
  .empty-main p{font-size:13px;line-height:1.8;color:#96b0b6;max-width:360px}.new-primary{background:#a9f8d4;color:#123d32;border:0;border-radius:11px;padding:15px 25px;font-size:12px;font-weight:800;margin-top:21px}
  .secondary-discover{background:none;color:#b3e9d1;border:0;font-size:11px;margin-top:12px;padding:10px}
  .mobile-sessions,.sheet-backdrop,.mobile-sheet{display:none}
  .toast{position:fixed;z-index:70;bottom:calc(env(safe-area-inset-bottom,0px) + 110px);left:50%;transform:translateX(-50%);padding:11px 16px;background:#c5f7dc;color:#193d31;font-size:12px;font-weight:760;border-radius:11px;text-align:center;max-width:92vw;box-shadow:0 20px 48px #0008}
  .term-page.immersive{position:fixed;inset:0;z-index:60;width:100vw;height:100dvh;padding-bottom:env(safe-area-inset-bottom,0px)}
  .immersive-exit{position:absolute;top:4px;right:8px;z-index:5;background:#24483d;color:#c9ffe5;border:1px solid #477363;border-radius:7px;padding:5px 10px;font-size:10px;font-weight:780}
  .term-page.immersive .session-column,.term-page.immersive .stage-header,.term-page.immersive .terminal-tabs{display:none}
  .term-page.immersive .console{margin:0;border:0;border-radius:0}
  @media(max-width:1220px){.session-column{width:210px}.stage-header{padding:17px}.shell-capability{font-size:8px}}
  @media(max-width:900px){.session-column{display:none}.stage-title{display:none}.mobile-sessions{display:flex;align-items:center;gap:9px;background:none;border:0;color:#e6f2f2;min-width:0;max-width:50vw;padding:0}
    .mobile-title{font-size:15px;font-weight:740;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.session-lines{font-size:20px;color:#aadfcb}.dropdown-indicator{color:#80a09b}
    .stage-header{min-height:54px;padding:8px 13px;height:54px}.status-connection{margin:0 3px;font-size:8px}.stage-actions{gap:3px}
    .icon-action{min-width:33px;height:34px;padding:0 8px;font-size:11px}
    .terminal-tabs{height:39px;padding:0 5px}.terminal-tabs button{padding:0 12px}.shell-capability{font-size:8px}
    .console{margin:7px 7px 0;border-radius:9px 9px 0 0}.terminal-dots{height:26px}.terminal-dots i{width:6px;height:6px}
    .quick-control-header{padding:6px 8px 0}.quick-caption{display:none}.quick-actions{width:100%;justify-content:space-between}.quick-actions button{font-size:10px;padding:8px 8px}
    .compose-row{margin:5px 8px 0;border-radius:12px;gap:7px}.dock-footer{padding:7px 12px 10px;font-size:9px}.dock-footer .mode-label{display:none}
    .sheet-backdrop{display:block;position:fixed;inset:0;background:#02080dbc;z-index:50;border:0}
    .mobile-sheet{display:flex;flex-direction:column;position:fixed;inset:auto 0 0;max-height:84dvh;padding:9px 15px calc(env(safe-area-inset-bottom,0px) + 18px);background:#172633;border-radius:24px 24px 0 0;border-top:1px solid #416257;z-index:51;box-shadow:0 -20px 90px #000b}
    .sheet-handle{width:38px;height:4px;border-radius:99px;background:#59717b;margin:0 auto 17px}
    .sheet-header{display:flex;align-items:center;justify-content:space-between}.sheet-header h2{font-size:20px;margin:0}.sheet-header button{background:none;border:0;font-size:17px;color:#c4dce2}
    .sheet-new{margin:17px 0 10px;background:#274b40;border:1px solid #467b62;border-radius:11px;color:#c3ffdc;padding:13px;font-size:12px;font-weight:750;text-align:left}
    .sheet-scroll{overflow-y:auto;min-height:0;scrollbar-width:thin}.sheet-scroll .group-label{margin-top:13px}
    .sheet-session{width:100%;display:flex;align-items:center;gap:12px;padding:11px 5px;border:0;border-bottom:1px solid #2c404a;background:none;color:#e8f1f4;text-align:left}
    .sheet-session>span:nth-child(2){flex:1;min-width:0;display:grid;gap:4px}.sheet-session strong{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sheet-session small{font-size:10px;color:#8faab1}
    .sheet-arrow{color:#92d3ba}.join{padding:9px 14px}
  }
  @media(max-width:430px){.status-connection{font-size:0;gap:0}.status-connection span{width:8px;height:8px}.full-toggle{display:none}.dock-footer{font-size:8px}.shell-capability{font-size:7px}.compose-row textarea{font-size:14px}}
  @media(prefers-reduced-motion:reduce){button{transition:none}}

  /* Pocket Studio: the terminal is the ENGINE, not the visual language.
     This is an intentional bright, refined workroom surrounding a genuine
     xterm PTY. Console bytes and session transport remain unchanged. */
  .term-page{background:#f8f8fc;color:#282a49;--accent:#7660dd;--line:#e3e2f0;--subtle:#918fa5}
  .session-column{background:#fcfbff;border-right:1px solid #e6e5f0}
  .column-title h2{font-size:19px;letter-spacing:-.7px;color:#292841}
  .eyebrow,.group-label,.quick-caption,.crumb{color:#a19bad}
  .count{color:#8979c0}
  .new-shell{height:40px;width:40px;border:0;border-radius:12px;background:#eeeaff;color:#7c62e4;box-shadow:0 4px 14px #7a6acf16;transition:transform .22s,background .22s}
  .new-shell:hover{transform:rotate(90deg) scale(1.05);background:#ded8fd}
  .search-container{background:#f2f0f9;border:1px solid #e5e2f1;border-radius:12px}
  .search-container span{color:#9182c7}.search-container input{color:#37334d;font-size:13px}.search-container input::placeholder{color:#a5a0b8}
  .session{color:#413e59;border:1px solid transparent;transition:background .22s,transform .2s}
  .session:hover{background:#f5f2ff;transform:translateX(2px)}
  .session.chosen{background:#eeeaff;border-color:#e0dafd;box-shadow:0 4px 15px #8173cc0c}
  .session-icon{background:#e9ebfa;color:#6c6dc7}.session-icon.agent{background:#f0e9fc;color:#8566bf}
  .session-info strong,.external-info strong{color:#3c3953}.session-info small,.external-info small{color:#9594aa}
  .discover-heading button{color:#8062d9}.external-icon{background:#efedfb;color:#8872b5}.external{color:#45435c}
  .join{background:#ece7ff;border:1px solid #d9ceff;color:#745bc6}.observe{color:#aaa2b9}
  .sidebar-footer{border-top:1px solid #e8e6f0}.sidebar-footer strong{color:#34324d}.sidebar-footer small{color:#9997ac}.sidebar-device{color:#8c73bf}
  .terminal-stage{background:#f8f8fc}
  .stage-header{background:#fbfbfe;border-bottom:1px solid #e8e8f1;min-height:97px;padding:20px 26px}
  .stage-title h1{color:#282640;letter-spacing:-.9px}.stage-title p{color:#8d8c9f}
  .status-pill{background:#e7f8f2;color:#269c7f;border:1px solid #d5f4e8}
  .status-pill span{background:#4bc79e}.status-pill.off{color:#b88991;background:#fff0f1;border-color:#f5dedf}
  .stage-actions .status-connection{color:#7f789c}.status-connection span{background:#56c5a3}
  .icon-action{background:#f0edf9;border:1px solid #e5e0f2;color:#6c628c;min-width:41px;height:41px;border-radius:12px;transition:transform .2s,background .2s}
  .icon-action:hover{background:#e5defd;transform:translateY(-2px)}
  .terminal-tabs{background:#fbfbfe;border-bottom:1px solid #e8e5f2}
  .terminal-tabs button{font-size:12px;color:#9b98ac}.terminal-tabs button.tab-active{color:#775ddc;border-bottom-color:#8a6bec}
  .shell-capability{color:#a49eb4}.shell-capability span{color:#d0cbd6}
  .console{border:1px solid #dddbee;border-radius:19px 19px 0 0;overflow:hidden;background:#171b33;box-shadow:0 14px 40px #29224c21;margin:12px 18px 0}
  .terminal-dots{display:none}
  .connection-overlay{inset:0;background:#171a30ed}.connection-overlay strong{color:#fff}
  .control-dock{background:#fff;border-top:1px solid #e9e7f3;box-shadow:0 -7px 22px #2324410a}
  .quick-caption{font-size:9px;color:#aba4b9}
  .quick-actions button{color:#8f8aa4;border-radius:10px;min-height:42px;font-size:11px;transition:background .2s,color .2s}
  .quick-actions button:hover{background:#f2effc;color:#6f58c8}
  .quick-actions button.mode-active{background:#eee8ff;color:#785fe0}
  .compose-row{background:#f6f5fc;border:1px solid #e2def2;border-radius:14px;min-height:56px;transition:border-color .2s,box-shadow .2s}
  .compose-row:focus-within{border-color:#a496ed;box-shadow:0 0 0 4px #a796ee1e}
  .prompt-glyph{color:#8b72e8}.compose-row textarea{color:#37334f;font-size:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .compose-row textarea::placeholder{color:#a09cb4}
  .send-command{height:43px;min-width:43px;background:#7b64e4;border-radius:12px;color:#fff;transition:transform .2s,box-shadow .2s}
  .send-command:hover:not(:disabled){box-shadow:0 8px 20px #7c65d953;transform:translateY(-1px)}
  .dock-footer{color:#a4a1b4}.safe-dot{background:#4fc3a0}
  .mode-label{color:#998cac}
  .empty-main{background:radial-gradient(ellipse at 50% 48%,#e4dfff8d,transparent 60%),#faf9fd}
  .empty-emblem{border:0;background:linear-gradient(135deg,#ac9cfc,#7865d9);color:#fff;box-shadow:0 18px 38px #745fc54a}
  .empty-main h2{color:#2c294a}.empty-main p{color:#8c889d}
  .new-primary{background:#806ae4;color:white;box-shadow:0 10px 22px #7c63dd33}.new-primary:hover{background:#6d52d6}
  .secondary-discover{color:#795ed9}
  .join-feedback{background:#e7f6ef;color:#339e79}.join-error{background:#fff0ef;color:#b76672}
  .term-page.immersive{background:#13172a}.term-page.immersive .console{border:0;margin:0;border-radius:0}
  .mobile-sheet{background:#fff;color:#2b2945;border-color:#e3dff6}
  .sheet-handle{background:#d2cfe2}.sheet-header h2{color:#302b49}.sheet-header button{color:#8b83ab}
  .sheet-new{background:#eeeaff;border:1px solid #d9d1fa;color:#7258c9}
  .sheet-session{color:#393550;border-bottom:1px solid #f0edf7}
  .sheet-session small{color:#9491a7}.sheet-arrow{color:#7f6bd0}
  .sheet-backdrop{background:#15112e9c;backdrop-filter:blur(5px)}
  @media(max-width:900px){
    .stage-header{background:#faf9ff;padding:6px 13px;min-height:53px;height:53px}
    .mobile-sessions{color:#39324f;max-width:57vw;min-height:44px}
    .session-lines{color:#816bd6}.dropdown-indicator{color:#8b79c8}
    .status-connection{color:#9f92b8}.icon-action{min-width:39px;height:39px;padding:0 8px;color:#7669ac}
    .terminal-tabs{background:#faf9ff;padding:0 6px}.terminal-tabs button{font-size:11px}
    .console{margin:8px 9px 0;border-radius:16px 16px 0 0}
    .quick-control-header{padding:5px 9px 0}.quick-actions button{min-height:39px;font-size:10px}
    .compose-row{margin:5px 9px 0;min-height:53px;padding:6px 8px}.compose-row textarea{font-size:16px}
    .dock-footer{padding:6px 11px 9px;font-size:9px}
    .mobile-sheet{animation:sheetUp .38s cubic-bezier(.22,1,.36,1) both}
  }
  @keyframes sheetUp{from{opacity:.75;transform:translateY(27px)}to{opacity:1;transform:translateY(0)}}
  @media(hover:none){.session:hover,.icon-action:hover,.new-shell:hover,.quick-actions button:hover{transform:none}}
  @media(prefers-reduced-motion:reduce){.mobile-sheet{animation:none}.session,.new-shell,.icon-action,.send-command,.quick-actions button{transition:none}}

</style>
