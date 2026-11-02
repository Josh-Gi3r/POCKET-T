<script lang="ts">
  import { onMount, tick } from 'svelte';
  import TerminalView from './TerminalView.svelte';
  import PTIcon from './PTIcon.svelte';
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
  let optionsOpen = $state(false);
  let keysOpen = $state(false);
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

<div class="work-root" class:focus-mode={fullScreen}>
  <!-- Desktop: a true session navigator, not a second faux terminal window. -->
  <aside class="sessions-sidebar" aria-label="Terminal session navigation">
    <div class="sessions-heading">
      <div>
        <span class="pt-eyebrow">WORKSPACES</span>
        <h2>Live sessions</h2>
      </div>
      <button class="pt-icon-button create-small" onclick={newSession} disabled={!online || $spawnState.status === 'starting'} title="New terminal" aria-label="New terminal"><PTIcon name="plus" size={19}/></button>
    </div>
    <div class="session-search">
      <PTIcon name="search" size={17}/>
      <input type="search" placeholder="Find a session" aria-label="Find a session" bind:value={sessionFilter}/>
    </div>
    <div class="session-list">
      <div class="group-head"><span>ON YOUR MAC</span><span>{managed.length}</span></div>
      {#each managed as s (s.sessionId)}
        <button class:chosen={selected?.sessionId === s.sessionId} class="session-tile" onclick={() => chooseSession(s.sessionId)}>
          <span class="session-tile-icon"><PTIcon name={s.vendor ? 'sparkles' : 'terminal'} size={19}/></span>
          <span class="session-tile-text"><strong>{displayName(s)}</strong><small>{vendorName(s)} · {s.detached ? 'Detached' : 'Live'}</small></span>
          <span class="pt-status-dot" data-state={s.detached ? 'offline' : 'online'}></span>
        </button>
      {/each}
      {#if managed.length === 0}
        <div class="empty-list">No open sessions here yet.</div>
      {/if}
      <div class="group-head discovered-head"><span>ALREADY OPEN</span><button onclick={discover} disabled={!online}><PTIcon name="refresh" size={14}/> Scan</button></div>
      {#each discovered as ext (ext.sessionId)}
        <div class="session-tile discovered-tile">
          <span class="session-tile-icon external-icon"><PTIcon name="window" size={18}/></span>
          <span class="session-tile-text"><strong>{ext.title}</strong><small>{ext.source === 'tmux' ? 'tmux' : ext.source === 'iterm2' ? 'iTerm2' : 'Terminal.app'}</small></span>
          {#if ext.source === 'tmux' && ext.capabilities.includes('join')}
            <button class="join-btn" onclick={() => joinExisting(ext)} disabled={!online || $joinState.status === 'joining'}>Join</button>
          {:else}
            <span class="read-only-label">Listed</span>
          {/if}
        </div>
      {/each}
      {#if discoverStarted && discovered.length === 0}<div class="empty-list">No other sessions found, or discovery isn’t permitted.</div>{/if}
      {#if $joinState.status === 'error'}<div class="error-feedback">{$joinState.message}</div>{/if}
      {#if $spawnState.status === 'error'}<div class="error-feedback">{$spawnState.message}</div>{/if}
      {#if $joinState.status === 'joining'}<div class="pending-feedback">Joining existing session…</div>{/if}
    </div>
    <div class="sidebar-help">
      <span class="sidebar-help-icon"><PTIcon name="info" size={18}/></span>
      <p>One Mac. Every session.<br/><span>No AI required.</span></p>
    </div>
  </aside>

  <section class="work-main">
    <header class="work-header">
      <div class="work-heading">
        <span class="pt-eyebrow">YOUR MAC <span class="crumb-divide">/</span> {selected ? 'ACTIVE WORKSPACE' : 'SESSIONS'}</span>
        <div class="work-title">
          <h1>{selected ? displayName(selected) : 'Your workspace.'}</h1>
          {#if selected}
            <span class="state-indicator"><span class="pt-status-dot" data-state={online && !selected.detached ? 'online' : 'offline'}></span>{online && !selected.detached ? 'Live' : selected.detached ? 'Detached' : 'Offline'}</span>
          {/if}
        </div>
        <p>{selected ? selected.cwd : 'Real terminal sessions. Beautifully connected.'}</p>
      </div>
      <div class="work-head-actions">
        <button class="mobile-current" onclick={() => (showSessions = true)} aria-label="Open session picker">
          <PTIcon name="layers" size={18}/><span>Sessions</span><PTIcon name="chevronDown" size={15}/>
        </button>
        <button class="pt-icon-button small-head-button" title="Scan existing Mac terminals" aria-label="Discover existing terminal sessions" onclick={() => { showSessions = true; discover(); }} disabled={!online}><PTIcon name="scan" size={20}/></button>
        <button class="pt-primary new-session" disabled={!online || $spawnState.status === 'starting'} onclick={newSession}>
          <PTIcon name="plus" size={18}/> <span>New session</span>
        </button>
      </div>
    </header>

    {#if selected}
      <div class="session-stage pt-card-enter">
        <div class="stage-toolbar">
          <div class="stage-tabs" role="tablist" aria-label="Session surfaces">
            <button class:tab-active={view === 'terminal'} role="tab" aria-selected={view === 'terminal'} onclick={() => chooseView('terminal')}>
              <PTIcon name="terminal" size={17}/> Live terminal
            </button>
            {#if selected.vendor}
              <button class:tab-active={view === 'activity'} role="tab" aria-selected={view === 'activity'} onclick={() => chooseView('activity')}>
                <PTIcon name="activity" size={17}/> Activity
              </button>
            {/if}
          </div>
          <div class="stage-controls">
            <span class="stage-machine"><PTIcon name="laptop" size={16}/> Mac</span>
            <button class="pt-icon-button action-button" title="Copy selected text" aria-label="Copy terminal selection" onclick={() => void copySelection()} disabled={view !== 'terminal'}><PTIcon name="copy" size={18}/></button>
            <button class="pt-icon-button action-button" title={fullScreen ? 'Exit focus mode' : 'Focus mode'} aria-label={fullScreen ? 'Exit focus mode' : 'Focus mode'} onclick={toggleFullscreen}><PTIcon name={fullScreen ? 'shrink' : 'expand'} size={18}/></button>
            <div class="options-holder">
              <button class="pt-icon-button action-button" title="Terminal settings" aria-label="Terminal settings" aria-expanded={optionsOpen} onclick={() => (optionsOpen = !optionsOpen)}><PTIcon name="more" size={20}/></button>
              {#if optionsOpen}
                <div class="options-menu">
                  <div>APPEARANCE</div>
                  <button onclick={() => adjustFont(1)}><PTIcon name="plus" size={17}/> Increase text size</button>
                  <button onclick={() => adjustFont(-1)}><PTIcon name="minus" size={17}/> Decrease text size</button>
                  <button onclick={() => { keysOpen = !keysOpen; optionsOpen = false; }}><PTIcon name="keyboard" size={17}/>{keysOpen ? 'Hide' : 'Show'} special keys</button>
                  <button onclick={() => { toggleFullscreen(); optionsOpen = false; }}><PTIcon name="expand" size={17}/> {fullScreen ? 'Exit focus' : 'Enter focus'} mode</button>
                </div>
              {/if}
            </div>
          </div>
        </div>

        <div class="screen-region">
          <div class="screen-surface">
            {#if view === 'terminal'}
              {#key selected.sessionId}
                <TerminalView
                  bind:this={terminalRef}
                  sessionId={selected.sessionId}
                  {fontSize}
                  interactive={online && !selected.detached}
                  onMultilinePaste={stageMultilinePaste}
                />
              {/key}
            {:else}
              <BubbleView sessionId={selected.sessionId}/>
            {/if}
          </div>
          {#if !online || selected.detached}
            <div class="offline-ribbon"><PTIcon name="info" size={15}/>{!online ? 'Connection interrupted. Terminal input is paused.' : 'This session is detached. Input is unavailable.'}</div>
          {/if}
        </div>

        <div class="command-area">
          <div class="command-heading">
            <div class="compose-label">
              <span class="compose-glow"><PTIcon name="bolt" size={14}/></span>
              <span>Terminal input</span>
            </div>
            <div class="mode-segment" role="group" aria-label="Input mode">
              <button class:mode-active={keyboardMode === 'compose'} onclick={focusCompose}><PTIcon name="file" size={14}/> Compose</button>
              <button class:mode-active={keyboardMode === 'direct'} onclick={focusDirect} disabled={!online || selected.detached || view !== 'terminal'}><PTIcon name="cursor" size={14}/> Direct</button>
            </div>
          </div>
          {#if keysOpen}
            <div class="keys-holder">
              <KeyboardRow disabled={!online || selected.detached}/>
            </div>
          {/if}
          <div class="command-box" class:needs-review={hasMultiline && multilineConfirmed}>
            <textarea
              bind:this={draftInput}
              aria-label="Compose command for the selected terminal"
              placeholder={keyboardMode === 'direct' ? 'Tap the live terminal to type directly, or compose here…' : 'Send a command to your Mac…'}
              rows="1"
              value={draft}
              oninput={(event) => setDraft(event.currentTarget.value)}
              onkeydown={onDraftKey}
              enterkeyhint="send"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
            ></textarea>
            <div class="command-buttons">
              <button class="paste-command pt-icon-button" onclick={() => void pasteDraft()} disabled={!online} title="Paste clipboard to editable input" aria-label="Paste clipboard"><PTIcon name="copy" size={19}/></button>
              <button class="send-command" class:review={hasMultiline && multilineConfirmed} onclick={sendDraft} disabled={!online || selected.detached || !draft.trim()}>
                {#if hasMultiline}<span>{multilineConfirmed ? 'Confirm' : 'Review'}</span>{/if}
                <PTIcon name="arrowUp" size={18}/>
              </button>
            </div>
          </div>
          <div class="command-footer">
            <div class="command-note"><PTIcon name="shield" size={14}/> {online ? 'Executes on your Mac. No AI or tokens needed.' : 'Disconnected. Drafts stay on this device.'}</div>
            <button class="keys-toggle" class:keys-active={keysOpen} onclick={() => (keysOpen = !keysOpen)}><PTIcon name="keyboard" size={16}/><span>{keysOpen ? 'Hide' : 'Special'} keys</span><PTIcon name={keysOpen ? 'chevronDown' : 'chevronUp'} size={14}/></button>
          </div>
        </div>
      </div>
    {:else}
      <div class="no-session pt-card-enter">
        <div class="no-session-art" aria-hidden="true"><div class="art-orbit"></div><div class="art-disc"><PTIcon name="layers" size={51} stroke={1.3}/></div></div>
        <span class="pt-eyebrow">READY WHEN YOU ARE</span>
        <h2>Stay in your flow,<br/>from anywhere.</h2>
        <p>Start a native shell or join a tmux session that's already open on your Mac. Everything runs for real, without AI tokens.</p>
        <div class="no-session-actions">
          <button class="pt-primary" onclick={newSession} disabled={!online || $spawnState.status === 'starting'}><PTIcon name="plus" size={18}/>{ $spawnState.status === 'starting' ? 'Starting…' : 'New session' }</button>
          <button class="pt-ghost" onclick={() => { showSessions = true; discover(); }} disabled={!online}><PTIcon name="scan" size={17}/> Find existing</button>
        </div>
        {#if $spawnState.status === 'error'}<div class="error-feedback">{$spawnState.message}</div>{/if}
      </div>
    {/if}
  </section>

  {#if showSessions}
    <button class="picker-backdrop" aria-label="Close session picker" onclick={() => (showSessions = false)}></button>
    <section class="session-picker" role="dialog" aria-modal="true" aria-label="Choose a terminal session">
      <div class="picker-handle" aria-hidden="true"></div>
      <div class="picker-header">
        <div><span class="pt-eyebrow">YOUR WORK</span><h2>Sessions</h2></div>
        <button class="pt-icon-button" onclick={() => (showSessions = false)} aria-label="Close session picker"><PTIcon name="x" size={20}/></button>
      </div>
      <div class="picker-tools">
        <button class="pt-primary" onclick={newSession} disabled={!online || $spawnState.status === 'starting'}><PTIcon name="plus" size={16}/> New session</button>
        <button class="pt-ghost scan-trigger" onclick={discover} disabled={!online}><PTIcon name="scan" size={17}/> Discover</button>
      </div>
      <div class="picker-list">
        <div class="group-head"><span>LIVE SESSIONS</span><span>{$sessions.length}</span></div>
        {#each $sessions as s (s.sessionId)}
          <button class:chosen={selected?.sessionId === s.sessionId} class="session-tile" onclick={() => chooseSession(s.sessionId)}>
            <span class="session-tile-icon"><PTIcon name={s.vendor ? 'sparkles' : 'terminal'} size={19}/></span>
            <span class="session-tile-text"><strong>{displayName(s)}</strong><small>{vendorName(s)} · {s.detached ? 'Detached' : 'Running'}</small></span>
            <PTIcon name="arrowUpRight" size={17}/>
          </button>
        {/each}
        <div class="group-head discovered-head"><span>ALREADY OPEN ON YOUR MAC</span><span>{$existingTerminals.length}</span></div>
        {#each $existingTerminals as ext (ext.sessionId)}
          <div class="session-tile discovered-tile">
            <span class="session-tile-icon external-icon"><PTIcon name="window" size={19}/></span>
            <span class="session-tile-text"><strong>{ext.title}</strong><small>{ext.source === 'tmux' ? 'tmux session' : ext.source === 'iterm2' ? 'iTerm2' : 'Terminal.app'}</small></span>
            {#if ext.source === 'tmux' && ext.capabilities.includes('join')}
              <button class="join-btn" onclick={() => joinExisting(ext)} disabled={!online || $joinState.status === 'joining'}>Join</button>
            {:else}<span class="read-only-label">Listed</span>{/if}
          </div>
        {/each}
        {#if $joinState.status === 'joining'}<div class="pending-feedback">Joining the existing tmux session…</div>{/if}
        {#if $joinState.status === 'error'}<div class="error-feedback">{$joinState.message}</div>{/if}
        {#if $spawnState.status === 'starting'}<div class="pending-feedback">Starting your native terminal…</div>{/if}
        {#if $spawnState.status === 'error'}<div class="error-feedback">{$spawnState.message}</div>{/if}
        {#if discoverStarted && !$existingTerminals.length}<div class="empty-list">No other terminals discovered, or macOS did not permit discovery.</div>{/if}
      </div>
      <div class="picker-caption"><PTIcon name="info" size={15}/> Existing Terminal.app and iTerm2 tabs are discoverable but not universally joinable.</div>
    </section>
  {/if}
  {#if notice}<div class="work-toast" role="status">{notice}</div>{/if}
</div>

<style>
  .work-root { position:relative;flex:1;display:flex;min-height:0;min-width:0;color:var(--pt-ink); }
  .sessions-sidebar {width:247px;flex:none;border-right:1px solid var(--pt-line);display:flex;flex-direction:column;padding:28px 13px 15px 17px;background:var(--pt-glass);min-height:0;}
  .sessions-heading {display:flex;align-items:center;justify-content:space-between;margin:0 7px 18px;}
  .sessions-heading h2 {font-size:18px;letter-spacing:-.7px;margin:8px 0 0;font-weight:760;}
  .create-small {background:var(--pt-violet-soft)!important;color:var(--pt-violet)!important;width:40px!important;height:40px!important;min-width:40px!important;border-radius:13px!important;}
  .session-search {display:flex;align-items:center;gap:9px;padding:0 12px;border-radius:12px;background:var(--pt-surface);border:1px solid var(--pt-line);height:43px;color:var(--pt-tertiary);margin:0 3px 20px;}
  .session-search input {border:0;background:none;outline:none;font-size:12px;flex:1;color:var(--pt-ink);width:100%;}.session-search input::placeholder{color:var(--pt-tertiary);}
  .session-list {flex:1;min-height:0;overflow-y:auto;padding-right:3px;scrollbar-width:thin;scrollbar-color:var(--pt-line-strong) transparent;}
  .group-head {display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:var(--pt-tertiary);font-weight:780;letter-spacing:.75px;padding:0 9px;margin:0 0 12px;}
  .group-head button{display:inline-flex;align-items:center;gap:5px;padding:6px;border-radius:8px;background:none;color:var(--pt-violet);font-size:11px;font-weight:750;letter-spacing:0;}
  .group-head button:hover{background:var(--pt-violet-soft);}
  .discovered-head {margin-top:29px;}
  .session-tile {display:flex;align-items:center;gap:10px;width:100%;padding:10px 10px;border-radius:14px;border:1px solid transparent;color:var(--pt-ink);text-align:left;background:none;min-height:58px;}
  button.session-tile:hover {background:var(--pt-surface);border-color:var(--pt-line);}
  button.session-tile.chosen {background:var(--pt-violet-soft);border-color:rgba(112,98,220,.15);}
  .session-tile-icon {display:grid;place-items:center;flex:none;width:37px;height:37px;border-radius:13px;background:var(--pt-surface);border:1px solid var(--pt-line);color:var(--pt-violet);}
  .session-tile.chosen .session-tile-icon {background:var(--pt-surface);border-color:transparent;}
  .session-tile-text {flex:1;min-width:0;display:grid;gap:5px;}
  .session-tile-text strong {font-size:12px;font-weight:730;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;}
  .session-tile-text small {font-size:10px;color:var(--pt-secondary);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
  .session-tile :global(.pt-status-dot) {height:6px;width:6px;}
  .discovered-tile {gap:8px;}
  .external-icon {color:var(--pt-secondary);background:var(--pt-surface-soft);}
  .join-btn {min-height:36px;padding:0 11px;background:var(--pt-violet-soft);color:var(--pt-violet);border-radius:10px;font-size:11px;font-weight:790;}
  .join-btn:hover{background:var(--pt-violet);color:#fff;}
  .read-only-label {font-size:10px;color:var(--pt-tertiary);font-weight:650;}
  .empty-list {font-size:12px;line-height:1.6;color:var(--pt-secondary);padding:17px 11px;}
  .pending-feedback,.error-feedback {padding:12px;margin:8px 6px;border-radius:11px;background:var(--pt-violet-soft);color:var(--pt-violet);font-size:11px;line-height:1.5;}
  .error-feedback{background:#fff0ec;color:#b34d45;}
  .sidebar-help {display:flex;align-items:center;gap:10px;border:1px solid var(--pt-line);border-radius:16px;padding:16px 10px;background:var(--pt-surface);margin-top:13px;}
  .sidebar-help-icon {display:grid;place-items:center;height:31px;width:31px;border-radius:10px;background:var(--pt-violet-soft);color:var(--pt-violet);flex:none;}
  .sidebar-help p {margin:0;font-size:11px;font-weight:700;line-height:1.6;}.sidebar-help p span{font-weight:500;color:var(--pt-secondary);}
  .work-main {display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;padding:32px clamp(21px,3.5vw,50px) 24px;overflow:hidden;}
  .work-header {display:flex;align-items:center;justify-content:space-between;gap:14px;flex:none;margin-bottom:25px;}
  .work-heading{min-width:0;flex:1;}
  .crumb-divide{margin:0 9px;color:var(--pt-tertiary);font-size:10px;}
  .work-title{display:flex;align-items:center;gap:13px;margin-top:7px;min-width:0;}
  .work-title h1{font-size:clamp(26px,2.8vw,39px);font-weight:730;letter-spacing:-1.6px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;max-width:530px;}
  .work-heading p{font-size:11px;color:var(--pt-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:9px 0 0;max-width:450px;}
  .state-indicator{display:inline-flex;align-items:center;gap:8px;background:var(--pt-teal-soft);border-radius:999px;padding:8px 11px;font-size:11px;font-weight:750;color:var(--pt-teal);white-space:nowrap;}
  .work-head-actions{display:flex;align-items:center;gap:7px;flex:none;}.new-session{white-space:nowrap;}
  .small-head-button{background:var(--pt-surface)!important;border:1px solid var(--pt-line)!important;box-shadow:var(--pt-shadow-small);}
  .mobile-current{display:none;}
  .session-stage{display:flex;flex-direction:column;flex:1;min-height:0;background:var(--pt-surface);border:1px solid var(--pt-line);border-radius:25px;overflow:hidden;box-shadow:var(--pt-shadow);}
  .stage-toolbar{display:flex;align-items:center;justify-content:space-between;gap:9px;flex:none;padding:9px 12px 9px 17px;border-bottom:1px solid var(--pt-line);min-height:56px;}
  .stage-tabs{display:flex;align-items:center;gap:4px;min-width:0;flex:1;}
  .stage-tabs button {display:inline-flex;align-items:center;gap:8px;padding:0 14px;min-height:39px;border-radius:12px;background:transparent;color:var(--pt-secondary);font-size:12px;font-weight:720;white-space:nowrap;}
  .stage-tabs button.tab-active{background:var(--pt-violet-soft);color:var(--pt-violet);}
  .stage-tabs button:hover:not(.tab-active){background:var(--pt-surface-soft);}
  .stage-controls{display:flex;align-items:center;gap:3px;}.stage-machine{display:flex;align-items:center;gap:7px;color:var(--pt-tertiary);font-size:11px;font-weight:700;padding:0 9px;}
  .action-button{height:37px!important;min-width:37px!important;border-radius:11px!important;}
  .options-holder{position:relative;}
  .options-menu{position:absolute;right:0;top:45px;width:228px;border-radius:15px;border:1px solid var(--pt-line-strong);box-shadow:var(--pt-shadow-float);background:var(--pt-surface);padding:8px;z-index:7;animation:menu-appear 175ms var(--pt-ease-out);}
  .options-menu>div{padding:9px 10px;font-size:10px;color:var(--pt-tertiary);font-weight:750;letter-spacing:.8px;}
  .options-menu button{display:flex;align-items:center;gap:11px;background:none;width:100%;padding:10px;border-radius:9px;color:var(--pt-secondary);font-size:12px;text-align:left;}
  .options-menu button:hover{background:var(--pt-surface-soft);color:var(--pt-ink);}
  @keyframes menu-appear{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
  .screen-region{display:flex;flex-direction:column;position:relative;min-height:0;flex:1;padding:14px 14px 0;background:var(--pt-surface);}
  .screen-surface{flex:1;min-height:0;min-width:0;display:flex;border-radius:18px 18px 0 0;overflow:hidden;background:#141624;box-shadow:inset 0 1px 0 #ffffff16;}
  .offline-ribbon{position:absolute;top:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:9px;background:#fee9df;color:#a44732;font-size:11px;font-weight:740;padding:10px 15px;border-radius:12px;white-space:nowrap;box-shadow:0 8px 25px #0003;z-index:2;max-width:95%;}
  .command-area{flex:none;padding:15px 19px 13px;background:var(--pt-surface);border-top:1px solid var(--pt-line);}
  .command-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;}
  .compose-label{display:flex;align-items:center;gap:9px;color:var(--pt-ink);font-weight:730;font-size:12px;}
  .compose-glow{height:25px;width:25px;border-radius:8px;display:grid;place-items:center;background:var(--pt-violet-soft);color:var(--pt-violet);}
  .mode-segment{display:flex;align-items:center;padding:3px;border:1px solid var(--pt-line);background:var(--pt-surface-soft);border-radius:12px;gap:3px;}
  .mode-segment button{display:flex;align-items:center;gap:6px;background:none;padding:0 11px;min-height:31px;border-radius:9px;color:var(--pt-secondary);font-size:11px;font-weight:720;}
  .mode-segment button.mode-active{background:var(--pt-surface);color:var(--pt-violet);box-shadow:var(--pt-shadow-small);}
  .command-box{display:flex;align-items:center;gap:8px;padding:6px 8px 6px 14px;border:1px solid var(--pt-line-strong);background:var(--pt-surface-soft);border-radius:16px;transition:border-color var(--pt-motion-medium) ease,box-shadow var(--pt-motion-medium) ease;}
  .command-box:focus-within{border-color:var(--pt-violet);box-shadow:0 0 0 3px rgba(98,89,234,.07);}
  .command-box.needs-review{border-color:var(--pt-amber);}
  .command-box textarea{border:0;background:transparent;resize:vertical;flex:1;min-height:29px;max-height:120px;color:var(--pt-ink);line-height:1.5;padding:7px 0;font-family:inherit;outline:none;white-space:pre-wrap;font-size:15px;}
  .command-box textarea::placeholder{color:var(--pt-tertiary);}
  .command-buttons{display:flex;align-items:center;gap:3px;flex:none;}.paste-command{height:36px!important;min-width:36px!important;}
  .send-command{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:40px;height:40px;border-radius:12px;color:white;background:#6259ea;font-size:11px;font-weight:760;padding:0 11px;}
  .send-command:hover:not(:disabled){background:#5047d9;box-shadow:0 5px 15px #6559de33;}
  .send-command.review{background:#b3773f;}
  .command-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;}
  .command-note{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--pt-tertiary);line-height:1.45;}
  .keys-toggle{display:inline-flex;align-items:center;gap:6px;min-height:35px;padding:0 8px;border-radius:9px;background:transparent;color:var(--pt-secondary);font-size:11px;font-weight:720;}
  .keys-toggle.keys-active{color:var(--pt-violet);background:var(--pt-violet-soft);}
  .keys-toggle:hover{background:var(--pt-surface-soft);}
  .keys-holder{border:1px solid var(--pt-line);border-radius:12px;overflow:hidden;margin-bottom:10px;}
  .keys-holder :global(.keybar){background:var(--pt-surface-soft);border-top:0;}
  .keys-holder :global(.keybar button){background:var(--pt-surface);border-color:var(--pt-line-strong);color:var(--pt-secondary);}
  .keys-holder :global(.keybar button.emphasized){background:var(--pt-violet-soft);color:var(--pt-violet);}
  .no-session{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border:1px solid var(--pt-line);border-radius:26px;background:var(--pt-surface);box-shadow:var(--pt-shadow-small);overflow:hidden;padding:33px;}
  .no-session-art{position:relative;display:grid;place-items:center;width:130px;height:130px;margin-bottom:24px;background:radial-gradient(circle,#eeedff,transparent 70%);}
  .art-orbit{position:absolute;width:118px;height:118px;border-radius:50%;border:1px solid #8f87f180;box-shadow:0 0 0 24px #ddd9ff25;}
  .art-disc{position:relative;display:grid;place-items:center;width:77px;height:77px;border-radius:23px;background:linear-gradient(145deg,#756ae7,#b5a9ff);color:white;box-shadow:0 15px 38px #756ae744;transform:rotate(-9deg);}
  .no-session h2{font-size:clamp(29px,3vw,39px);line-height:1.14;letter-spacing:-1.6px;margin:16px 0 12px;font-weight:730;}
  .no-session p{font-size:13px;line-height:1.7;color:var(--pt-secondary);max-width:375px;}
  .no-session-actions{display:flex;align-items:center;gap:9px;margin-top:23px;}
  .no-session-actions :global(.pt-primary){min-height:45px;}
  .picker-backdrop{position:fixed;inset:0;border:0;background:#15142765;backdrop-filter:blur(5px);z-index:59;animation:picker-dim 250ms ease;}
  .session-picker{position:fixed;right:0;top:0;bottom:0;width:min(420px,90vw);background:var(--pt-surface);box-shadow:var(--pt-shadow-float);z-index:60;display:flex;flex-direction:column;padding:24px;animation:picker-enter 330ms var(--pt-ease-out);}
  .picker-handle{display:none;}
  .picker-header{display:flex;align-items:center;justify-content:space-between;}
  .picker-header h2{font-size:27px;letter-spacing:-.9px;margin:7px 0 0;}
  .picker-tools{display:flex;align-items:center;gap:9px;margin:23px 0 25px;}
  .picker-tools :global(.pt-primary){flex:1;}
  .picker-list{flex:1;min-height:0;overflow-y:auto;}
  .picker-list .group-head {margin-top:18px;}
  .picker-list .session-tile{min-height:62px;}
  .picker-caption{display:flex;gap:10px;align-items:start;font-size:11px;color:var(--pt-secondary);line-height:1.6;border-top:1px solid var(--pt-line);padding-top:15px;}
  .picker-caption svg{flex:none;color:var(--pt-violet);}
  .work-toast{position:fixed;z-index:80;bottom:calc(env(safe-area-inset-bottom,0px) + 24px);left:50%;transform:translateX(-50%);max-width:90vw;min-height:45px;padding:12px 17px;background:var(--pt-ink);color:var(--pt-surface);box-shadow:var(--pt-shadow-float);border-radius:14px;display:grid;place-items:center;font-size:12px;font-weight:750;text-align:center;}
  @keyframes picker-enter{from{transform:translateX(30px);opacity:.6}to{transform:translateX(0);opacity:1}}
  @keyframes picker-dim{from{opacity:0}to{opacity:1}}
  .work-root.focus-mode{position:fixed;inset:0;z-index:90;background:#141624;padding:0;height:100dvh;width:100vw;}
  .focus-mode .sessions-sidebar,.focus-mode .work-header{display:none;}
  .focus-mode .work-main{padding:0;}.focus-mode .session-stage{border:0;border-radius:0;box-shadow:none;}
  .focus-mode .stage-toolbar{background:#1c1d2e;border:0;color:white;}
  .focus-mode .stage-tabs button:not(.tab-active){color:#c8c8da;}.focus-mode .stage-tabs button.tab-active{background:#38334e;color:#e3d5ff;}
  .focus-mode .stage-controls{color:#d8d9ee;}
  .focus-mode .screen-region{padding:0;background:#141624;}
  .focus-mode .screen-surface{border-radius:0;}
  .focus-mode .command-area{background:#1e2030;border:0;}
  .focus-mode .command-heading,.focus-mode .compose-label,.focus-mode .command-note{color:#ebebf5;}
  .focus-mode .mode-segment{background:#2c2e43;border-color:#46455b;}.focus-mode .mode-segment button{color:#c9cbdb;}.focus-mode .mode-segment button.mode-active{background:#484262;color:#fff;}
  .focus-mode .command-box{background:#292b41;border-color:#3f4159;}.focus-mode .command-box textarea{color:white;}
  .focus-mode .keys-toggle{color:#e1dbff;}
  @media(max-width:1180px){.sessions-sidebar{width:220px}.work-main{padding:28px 23px 20px}.stage-machine{display:none}}
  @media(max-width:900px){
    .work-root{min-height:0;}
    .sessions-sidebar{display:none;}
    .work-main{padding:18px 13px 14px;}
    .work-header{margin-bottom:16px;}
    .work-title h1{font-size:28px;max-width:calc(100vw - 225px);letter-spacing:-1.3px;}
    .work-heading p{max-width:55vw;}
    .work-head-actions{gap:5px;}
    .mobile-current{display:flex;align-items:center;gap:7px;min-height:43px;padding:0 12px;border-radius:13px;background:var(--pt-surface);border:1px solid var(--pt-line);color:var(--pt-ink);font-size:12px;font-weight:760;}
    .new-session{min-height:43px!important;padding:0 13px!important;}
    .new-session span{display:none;}
    .small-head-button{display:none!important;}
    .session-stage{border-radius:20px;}
    .stage-toolbar{padding:7px 8px;min-height:49px;}
    .stage-tabs button{padding:0 12px;gap:6px;font-size:11px;}
    .stage-controls{gap:0;}
    .action-button{min-width:34px!important;width:34px!important;height:37px!important;}
    .screen-region{padding:8px 8px 0;}
    .screen-surface{border-radius:13px 13px 0 0;}
    .command-area{padding:11px 12px 12px;}
    .command-heading{margin-bottom:9px;}
    .compose-label{font-size:11px;}
    .mode-segment button{font-size:10px;padding:0 8px;}
    .command-box{border-radius:14px;}
    .command-box textarea{font-size:16px;}
    .command-footer{margin-top:6px;}
    .command-note{font-size:9px;line-height:1.3;}
    .keys-toggle{min-height:32px;font-size:10px;}
    .work-toast{bottom:calc(env(safe-area-inset-bottom,0px) + 16px);}
    .session-picker{top:auto;left:0;right:0;bottom:0;width:100%;max-height:83dvh;border-radius:28px 28px 0 0;padding:11px 20px calc(20px + env(safe-area-inset-bottom,0px));animation:picker-up 340ms var(--pt-ease-out);}
    .picker-handle{display:block;width:43px;height:5px;background:var(--pt-line-strong);border-radius:99px;margin:0 auto 15px;}
    .picker-header h2{font-size:25px;}
    @keyframes picker-up{from{transform:translateY(35px);opacity:.65}to{transform:translateY(0);opacity:1}}
  }
  @media(max-width:450px){
    .work-main{padding:14px 9px 10px;}
    .work-header{margin-bottom:12px;}
    .work-title h1{font-size:24px;max-width:190px;}
    .work-heading p{max-width:190px;font-size:10px;}
    .state-indicator{font-size:10px;padding:6px 8px;}
    .mobile-current span{display:none;}
    .mobile-current{width:44px;min-width:44px;justify-content:center;padding:0;}
    .mobile-current :global(svg:last-child){display:none;}
    .stage-toolbar{padding:6px;}
    .stage-tabs button{padding:0 9px;font-size:10px;}
    .action-button{min-width:32px!important;width:32px!important;}
    .stage-controls button:nth-child(1){display:none;}
    .compose-label{font-size:10px;gap:5px;}
    .compose-glow{height:24px;width:24px;}
    .mode-segment button{padding:0 7px;}
    .command-area{padding:10px 10px 8px;}
    .command-note{max-width:230px;line-height:1.25;}
    .keys-toggle span{display:none;}
  }
  @media(prefers-reduced-motion:reduce){.session-picker,.picker-backdrop,.options-menu{animation:none;}}
</style>