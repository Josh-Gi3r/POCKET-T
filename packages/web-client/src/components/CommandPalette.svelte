<script lang="ts">
  import { onMount, tick } from 'svelte';
  import UiIcon from './UiIcon.svelte';
  import { sessions } from '../lib/store';

  type Destination = 'home' | 'terminals' | 'files' | 'apps' | 'machine' | 'vault';
  let { onDismiss, onNavigate, onOpenSession, onNewTerminal }: {
    onDismiss: () => void;
    onNavigate: (to: Destination) => void;
    onOpenSession: (id: string) => void;
    onNewTerminal: () => void;
  } = $props();

  let search = $state('');
  let selected = $state(0);
  let input: HTMLInputElement;
  const commands = [
    { id: 'home', label: 'Workspace overview', description: 'Your personal control space', icon: 'grid' as const, target: 'home' as Destination },
    { id: 'terminals', label: 'All terminals', description: 'Join your live Mac sessions', icon: 'terminal' as const, target: 'terminals' as Destination },
    { id: 'files', label: 'Files & folders', description: 'Browse authorised folders', icon: 'files' as const, target: 'files' as Destination },
    { id: 'apps', label: 'Applications', description: 'Open approved Mac apps', icon: 'apps' as const, target: 'apps' as Destination },
    { id: 'machine', label: 'My Mac', description: 'Device connectivity and permissions', icon: 'computer' as const, target: 'machine' as Destination },
  ];

  const options = $derived([
    { id: '__new', label: 'Start a new terminal', description: 'Open a real shell on your Mac', icon: 'plus' as const, action: () => onNewTerminal() },
    ...commands.map((cmd) => ({ ...cmd, action: () => onNavigate(cmd.target) })),
    ...$sessions.slice(0, 15).map((s) => ({
      id: s.sessionId,
      label: s.cwd.split('/').filter(Boolean).at(-1) || 'Live session',
      description: (s.vendor || 'Shell') + ' · ' + s.cwd,
      icon: 'terminal' as const,
      action: () => onOpenSession(s.sessionId),
    })),
  ].filter((option) =>
    !search.trim() || (option.label + ' ' + option.description).toLowerCase().includes(search.trim().toLowerCase())));
  function run(index: number): void {
    const option = options[index];
    if (!option) return;
    onDismiss();
    option.action();
  }
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') { event.preventDefault(); onDismiss(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); selected = Math.min(options.length - 1, selected + 1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); selected = Math.max(0, selected - 1); }
    if (event.key === 'Enter') { event.preventDefault(); run(selected); }
  }
  $effect(() => { void search; selected = 0; });
  onMount(() => {
    const prior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void tick().then(() => input?.focus());
    return () => prior?.focus();
  });
</script>

<div class="shade" role="presentation">
  <button class="scrim" aria-label="Close command center" onclick={onDismiss}></button>
  <section class="palette" role="dialog" aria-modal="true" aria-label="Quick commands" onkeydown={onKeyDown}>
    <div class="palette-search"><UiIcon name="search" size={22}/><input bind:this={input} bind:value={search} placeholder="What would you like to open?" autocomplete="off" aria-label="Search commands and sessions"/><button class="close" onclick={onDismiss} aria-label="Close command palette"><UiIcon name="close" size={17}/></button></div>
    <div class="palette-caption">QUICK ACTIONS & LIVE SESSIONS <span>{options.length} MATCHES</span></div>
    <div class="palette-results">
      {#each options as option, i (option.id)}
        <button class:chosen={i === selected} onmouseenter={() => (selected = i)} onclick={() => run(i)}>
          <span class="command-icon"><UiIcon name={option.icon} size={19}/></span>
          <span class="command-text"><strong>{option.label}</strong><small>{option.description}</small></span>
          <UiIcon name="arrow-up-right" size={17}/>
        </button>
      {/each}
      {#if !options.length}<div class="palette-empty">No matching commands or sessions.</div>{/if}
    </div>
    <footer><span><kbd>↑</kbd><kbd>↓</kbd> Browse</span><span><kbd>↵</kbd> Open</span><span><kbd>Esc</kbd> Close</span><strong>POCKET-T</strong></footer>
  </section>
</div>

<style>
  .shade{position:fixed;inset:0;z-index:300;display:flex;align-items:flex-start;justify-content:center;padding:clamp(62px,13vh,135px) 15px 30px}
  .scrim{position:absolute;inset:0;background:#10152b88;border:0;backdrop-filter:blur(12px);animation:shade-in .19s ease-out}
  .palette{position:relative;width:min(560px,100%);max-height:calc(100dvh - 100px);display:flex;flex-direction:column;background:var(--pt-popover);border:1px solid var(--pt-line);border-radius:24px;box-shadow:0 25px 100px #0d143555;overflow:hidden;animation:palette-in .32s cubic-bezier(.15,1,.3,1);color:var(--pt-text)}
  .palette-search{display:flex;align-items:center;gap:13px;padding:17px 19px;border-bottom:1px solid var(--pt-line);color:var(--pt-accent)}
  .palette-search input{flex:1;min-width:0;background:none;border:0;outline:0;font-size:16px;font-family:inherit;color:var(--pt-text)}
  .palette-search input::placeholder{color:var(--pt-muted)}
  .close{height:34px;width:34px;border:0;border-radius:10px;background:var(--pt-subtle);color:var(--pt-secondary);display:grid;place-items:center}
  .palette-caption{font-size:9px;letter-spacing:1.2px;font-weight:830;color:var(--pt-muted);padding:18px 23px 9px;display:flex;justify-content:space-between}
  .palette-results{overflow-y:auto;min-height:0;padding:0 10px 13px}
  .palette-results>button{width:100%;border:1px solid transparent;background:transparent;border-radius:13px;padding:11px 12px;display:flex;align-items:center;text-align:left;gap:12px;color:var(--pt-text)}
  .palette-results>button.chosen,.palette-results>button:hover{background:var(--pt-subtle);border-color:var(--pt-line)}
  .command-icon{height:39px;width:39px;display:grid;place-items:center;background:var(--pt-glass);border:1px solid var(--pt-line);border-radius:12px;color:var(--pt-accent)}
  .command-text{flex:1;display:grid;gap:4px;min-width:0}.command-text strong{font-size:13px;font-weight:760}.command-text small{font-size:11px;color:var(--pt-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .palette-results>button>svg{color:var(--pt-muted)}.palette-empty{padding:30px;text-align:center;color:var(--pt-secondary);font-size:13px}
  footer{display:flex;align-items:center;gap:18px;border-top:1px solid var(--pt-line);padding:13px 19px;font-size:10px;color:var(--pt-muted)}
  footer>span{display:flex;align-items:center;gap:4px}footer strong{margin-left:auto;font-size:9px;letter-spacing:1px;color:var(--pt-accent)}
  kbd{background:var(--pt-subtle);border-radius:5px;border:1px solid var(--pt-line);padding:2px 5px;font-size:10px;color:var(--pt-secondary)}
  @keyframes shade-in{from{opacity:0}}@keyframes palette-in{from{opacity:0;transform:translateY(-14px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
  @media(max-width:650px){.shade{padding:calc(env(safe-area-inset-top,0px) + 68px) 13px 20px}.palette{border-radius:19px;max-height:70dvh}.palette-search{padding:14px}.palette-caption{padding:14px 16px 8px}footer{gap:10px;padding:12px}footer strong{display:none}}
  @media(prefers-reduced-motion:reduce){.palette,.scrim{animation:none}}
</style>
