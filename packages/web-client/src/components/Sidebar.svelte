<script lang="ts">
  import { sessions, current, status, attach, spawnSession, killSession } from '../lib/store';
  import type { SessionInfo } from '../lib/types';

  let { open = $bindable(false), onEnablePush }: { open?: boolean; onEnablePush: () => void } =
    $props();

  function pick(s: SessionInfo) {
    attach(s.sessionId);
    open = false;
  }

  function relTime(ts: number): string {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
  }
</script>

<div class="scrim" class:open onclick={() => (open = false)} aria-hidden="true"></div>

<aside class="drawer" class:open>
  <div class="drawer-head">
    <strong>Sessions</strong>
    <button class="close" aria-label="Close" onclick={() => (open = false)}>✕</button>
  </div>

  <div class="list">
    {#each $sessions as s (s.sessionId)}
      <div
        class="row"
        class:active={s.sessionId === $current}
        role="button"
        tabindex="0"
        onclick={() => pick(s)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick(s);
          }
        }}
      >
        <div class="row-main">
          <span class="vendor">{s.vendor ?? s.shell.split('/').slice(-1)[0]}</span>
          {#if s.detached}<span class="badge detached">detached</span>{/if}
          {#if s.pendingApprovals > 0}<span class="badge appr">{s.pendingApprovals}●</span>{/if}
        </div>
        <div class="row-sub mono">{s.cwd}</div>
        <div class="row-meta">
          <span>{relTime(s.lastActiveAt)} ago</span>
          <button
            class="kill"
            aria-label="End session"
            onclick={(e) => {
              e.stopPropagation();
              killSession(s.sessionId);
            }}>×</button
          >
        </div>
      </div>
    {/each}
    {#if $sessions.length === 0}
      <div class="none">
        {$status === 'open' ? 'No active sessions.' : 'Connecting to daemon…'}
      </div>
    {/if}
  </div>

  <div class="drawer-foot">
    <button class="new" onclick={() => spawnSession()}>+ New session</button>
    <button class="ghost" onclick={onEnablePush}>Enable notifications</button>
    <div class="conn mono">status: {$status}</div>
  </div>
</aside>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
    z-index: 20;
  }
  .scrim.open {
    opacity: 1;
    pointer-events: auto;
  }
  .drawer {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(84vw, 340px);
    background: var(--bg-elev);
    border-right: 1px solid var(--border);
    transform: translateX(-100%);
    transition: transform 0.22s ease;
    z-index: 21;
    display: flex;
    flex-direction: column;
    padding-left: var(--safe-left);
  }
  .drawer.open {
    transform: translateX(0);
  }
  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: calc(var(--safe-top) + 12px) 14px 12px;
    border-bottom: 1px solid var(--border);
  }
  .close {
    background: none;
    border: none;
    font-size: 16px;
    color: var(--text-dim);
  }
  .list {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .row {
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .row.active {
    background: var(--bg-card);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .row-main {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .vendor {
    font-weight: 600;
    font-size: 14px;
  }
  .badge {
    font-size: 10px;
    border-radius: 6px;
    padding: 1px 6px;
  }
  .badge.detached {
    background: var(--approval);
    color: #e0b33f;
  }
  .badge.appr {
    background: var(--accent-dim);
    color: var(--accent);
  }
  .row-sub {
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 10px;
    color: var(--text-dim);
  }
  .kill {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 16px;
    line-height: 1;
    padding: 0 4px;
  }
  .none {
    padding: 24px 14px;
    color: var(--text-dim);
    font-size: 13px;
  }
  .drawer-foot {
    border-top: 1px solid var(--border);
    padding: 12px 14px calc(var(--safe-bottom) + 12px);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .new {
    background: var(--accent);
    color: #04150c;
    border: none;
    border-radius: 8px;
    padding: 10px;
    font-weight: 700;
  }
  .ghost {
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px;
    color: var(--text-dim);
  }
  .conn {
    font-size: 11px;
    color: var(--text-dim);
    text-align: center;
  }
</style>
