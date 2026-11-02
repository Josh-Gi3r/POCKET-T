<script lang="ts">
  import { onMount } from 'svelte';
  import PTIcon from './PTIcon.svelte';
  import { sessions, status, spawnState, spawnSession } from '../lib/store';
  import type { SessionInfo } from '../lib/types';

  type Route = 'home' | 'terminal' | 'files' | 'apps' | 'machine' | 'vault';
  type Action = { id: string; title: string; subtitle: string; icon: string; section?: Route; sessionId?: string; special?: 'new' | 'theme'; };
  let { onClose, onNavigate, onOpenSession, onTheme } : {
    onClose: () => void;
    onNavigate: (section: Route) => void;
    onOpenSession: (id: string) => void;
    onTheme: () => void;
  } = $props();

  let search = $state('');
  let activeIndex = $state(0);
  let searchInput = $state<HTMLInputElement | undefined>(undefined);

  const quick: Action[] = [
    { id: 'home', title: 'Overview', subtitle: 'Your connected workspace', icon: 'home', section: 'home' },
    { id: 'terminals', title: 'Workspaces', subtitle: 'Live terminal sessions', icon: 'layers', section: 'terminal' },
    { id: 'files', title: 'Files', subtitle: 'Browse approved folders', icon: 'folder', section: 'files' },
    { id: 'apps', title: 'Applications', subtitle: 'Open approved Mac apps', icon: 'apps', section: 'apps' },
    { id: 'machine', title: 'My Mac', subtitle: 'Machine and connectivity', icon: 'laptop', section: 'machine' },
    { id: 'new', title: 'New terminal session', subtitle: 'Start a real shell on your Mac', icon: 'plus', special: 'new' },
    { id: 'theme', title: 'Switch appearance', subtitle: 'Toggle light and dark', icon: 'moon', special: 'theme' },
  ];

  function title(s: SessionInfo): string {
    return s.cwd.split('/').filter(Boolean).pop() || 'Shell';
  }
  const actions = $derived([
    ...quick,
    ...$sessions.map((s): Action => ({
      id: 'session:' + s.sessionId,
      title: title(s),
      subtitle: s.detached ? 'Detached terminal' : (s.vendor ? s.vendor + ' · Live session' : 'Live terminal'),
      icon: s.vendor ? 'sparkles' : 'terminal',
      sessionId: s.sessionId,
    })),
  ]);
  const visible = $derived(actions.filter((a) => {
    const q = search.trim().toLowerCase();
    return !q || (a.title + ' ' + a.subtitle).toLowerCase().includes(q);
  }));
  $effect(() => {
    void search;
    activeIndex = 0;
  });

  onMount(() => {
    searchInput?.focus();
  });

  function execute(a: Action): void {
    if (a.sessionId) {
      onOpenSession(a.sessionId);
    } else if (a.special === 'new') {
      if ($status !== 'open' || $spawnState.status === 'starting') return;
      spawnSession();
      onNavigate('terminal');
    } else if (a.special === 'theme') {
      onTheme();
    } else if (a.section) {
      onNavigate(a.section);
    }
    onClose();
  }

  function onKeyboard(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (visible.length) activeIndex = Math.min(visible.length - 1, activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const choice = visible[activeIndex];
      if (choice) execute(choice);
    }
  }
</script>

<div class="palette-layer">
  <button class="palette-backdrop" aria-label="Dismiss search" onclick={onClose}></button>
  <section class="palette" role="dialog" aria-modal="true" aria-label="Pocket-T command palette">
    <div class="palette-field">
      <PTIcon name="search" size={22}/>
      <input bind:this={searchInput} bind:value={search} onkeydown={onKeyboard} placeholder="Find anything in Pocket-T…" aria-label="Search workspaces and sessions" autocomplete="off" spellcheck="false"/>
      <button class="escape-button" onclick={onClose} aria-label="Close search"><PTIcon name="x" size={18}/></button>
    </div>
    <div class="palette-results" role="listbox" aria-label="Search results">
      <div class="result-heading">{search ? 'MATCHING RESULTS' : 'QUICK ACCESS'} <span>{visible.length}</span></div>
      {#each visible as a, i (a.id)}
        <button class:selected={activeIndex === i} role="option" aria-selected={activeIndex === i} onclick={() => execute(a)} onpointerenter={() => (activeIndex = i)}>
          <span class="result-icon"><PTIcon name={a.icon} size={20}/></span>
          <span class="result-text"><strong>{a.title}</strong><small>{a.subtitle}</small></span>
          {#if a.special === 'new' && $status !== 'open'}<span class="disabled-label">OFFLINE</span>{:else}<PTIcon name="arrowUpRight" size={17}/>{/if}
        </button>
      {/each}
      {#if visible.length === 0}
        <div class="result-empty">No matches. Try a project, session, or workspace name.</div>
      {/if}
    </div>
    <div class="palette-footer">
      <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
      <span><kbd>↵</kbd> Open</span>
      <span><kbd>Esc</kbd> Close</span>
    </div>
  </section>
</div>

<style>
  .palette-layer{position:fixed;inset:0;z-index:100;display:flex;align-items:flex-start;justify-content:center;padding:clamp(70px,12vh,155px) 18px 20px;}
  .palette-backdrop{position:absolute;inset:0;background:rgba(22,23,46,.35);border:0;backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);animation:shade-in 200ms ease;}
  .palette{position:relative;width:min(590px,100%);border-radius:23px;background:var(--pt-surface);border:1px solid var(--pt-line-strong);box-shadow:0 37px 100px #181a3750;overflow:hidden;display:flex;flex-direction:column;max-height:min(600px,78dvh);animation:palette-enter 310ms var(--pt-ease-spring);}
  .palette-field{display:flex;align-items:center;gap:15px;padding:20px 20px;color:var(--pt-violet);border-bottom:1px solid var(--pt-line);}
  .palette-field input{flex:1;min-width:0;border:0;background:none;outline:0;font-size:16px;color:var(--pt-ink);font-weight:570;line-height:1.4;}
  .palette-field input::placeholder{color:var(--pt-tertiary);}
  .escape-button{display:grid;place-items:center;height:35px;width:35px;color:var(--pt-tertiary);background:var(--pt-surface-soft);border-radius:10px;}
  .escape-button:hover{color:var(--pt-ink);}
  .palette-results{overflow-y:auto;min-height:0;padding:11px;scrollbar-width:thin;}
  .result-heading{display:flex;justify-content:space-between;color:var(--pt-tertiary);font-size:10px;letter-spacing:1.1px;font-weight:770;padding:13px 12px 10px;}
  .palette-results button{display:flex;align-items:center;gap:12px;text-align:left;width:100%;min-height:64px;padding:9px 13px;border-radius:14px;background:none;color:var(--pt-secondary);}
  .palette-results button:hover,.palette-results button.selected{background:var(--pt-violet-soft);color:var(--pt-violet);}
  .result-icon{display:grid;place-items:center;width:40px;height:40px;background:var(--pt-surface-soft);border-radius:12px;color:var(--pt-violet);flex:none;}
  .palette-results button:hover .result-icon,.palette-results button.selected .result-icon{background:var(--pt-surface);}
  .result-text{display:grid;gap:3px;min-width:0;flex:1;}.result-text strong{font-size:13px;color:var(--pt-ink);font-weight:740;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.result-text small{font-size:11px;color:var(--pt-secondary);}
  .disabled-label{font-size:9px;font-weight:760;letter-spacing:.7px;color:var(--pt-tertiary);}
  .result-empty{padding:34px 15px;color:var(--pt-secondary);font-size:13px;text-align:center;}
  .palette-footer{border-top:1px solid var(--pt-line);padding:12px 18px;display:flex;align-items:center;gap:18px;font-size:10px;color:var(--pt-tertiary);background:var(--pt-surface-soft);}
  .palette-footer span{display:flex;align-items:center;gap:4px;}
  kbd{font-family:inherit;display:inline-grid;place-items:center;min-width:20px;height:21px;border-radius:6px;padding:0 4px;border:1px solid var(--pt-line-strong);background:var(--pt-surface);font-weight:700;font-size:10px;margin-right:2px;}
  @keyframes shade-in{from{opacity:0}to{opacity:1}}
  @keyframes palette-enter{from{opacity:.5;transform:translateY(-13px) scale(.975)}to{opacity:1;transform:translateY(0) scale(1)}}
  @media(max-width:650px){.palette-layer{padding:calc(env(safe-area-inset-top,0px) + 52px) 12px 16px;}.palette{border-radius:20px;max-height:77dvh;}.palette-field{padding:15px;gap:10px}.palette-footer{gap:12px;padding:11px;}.palette-results button{min-height:61px;}}
  @media(prefers-reduced-motion:reduce){.palette-backdrop,.palette{animation:none}}
</style>