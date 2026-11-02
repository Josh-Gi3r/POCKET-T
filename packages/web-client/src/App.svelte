<script lang="ts">
  import { onMount } from 'svelte';
  import WorkspaceHome from './components/WorkspaceHome.svelte';
  import TerminalWorkspace from './components/TerminalWorkspace.svelte';
  import FilesWorkspace from './components/FilesWorkspace.svelte';
  import AppsWorkspace from './components/AppsWorkspace.svelte';
  import VaultWorkspace from './components/VaultWorkspace.svelte';
  import Icon from './components/Icon.svelte';
  import { status, sessions, current, attach, spawnSession, spawnState } from './lib/store';

  type Section = 'home' | 'terminals' | 'files' | 'apps' | 'machine' | 'vault';
  type NavIcon = 'home' | 'terminal' | 'folder' | 'apps' | 'machine' | 'vault';
  const primary: { key: Section; name: string; icon: NavIcon }[] = [
    { key: 'home', name: 'Overview', icon: 'home' },
    { key: 'terminals', name: 'Live sessions', icon: 'terminal' },
    { key: 'files', name: 'Files & folders', icon: 'folder' },
    { key: 'apps', name: 'Applications', icon: 'apps' },
    { key: 'machine', name: 'My Mac', icon: 'machine' },
  ];
  const actions = [
    { id: 'home', label: 'Open overview', detail: 'Your workspace', icon: 'home' },
    { id: 'continue', label: 'Continue live session', detail: 'Return to the real terminal', icon: 'terminal' },
    { id: 'new', label: 'Start new terminal', detail: 'New PTY on your Mac', icon: 'plus' },
    { id: 'files', label: 'Browse files', detail: 'Folders permitted by your Mac', icon: 'folder' },
    { id: 'apps', label: 'Open applications', detail: 'Allowed Mac applications', icon: 'apps' },
    { id: 'machine', label: 'Machine status', detail: 'Connection and capabilities', icon: 'machine' },
  ] as const;

  let section = $state<Section>('home');
  let commandOpen = $state(false);
  let commandQuery = $state('');
  let paletteInput = $state<HTMLInputElement | undefined>(undefined);
  let keyboardInset = $state(0);
  let navOpen = $state(false);
  $effect(() => {
    if (commandOpen) {
      const focus = paletteInput;
      // Focus after the modal's input is mounted; no HTML autofocus.
      if (focus) queueMicrotask(() => focus.focus());
    }
  });
  const connected = $derived($status === 'open');
  const selected = $derived($sessions.find(s => s.sessionId === $current) ?? $sessions[0] ?? null);
  const activeCount = $derived($sessions.filter(s => !s.detached).length);
  const shownActions = $derived(actions.filter(a =>
    !commandQuery || (a.label + ' ' + a.detail).toLowerCase().includes(commandQuery.toLowerCase())
  ));

  function move(to: Section) {
    section = to;
    navOpen = false;
    commandOpen = false;
    commandQuery = '';
  }
  function openSession(id: string) {
    attach(id);
    move('terminals');
  }
  function newSession() {
    if (!connected || $spawnState.status === 'starting') return;
    spawnSession();
    move('terminals');
  }
  function perform(action: string) {
    if (action === 'continue') {
      if (selected) openSession(selected.sessionId); else move('terminals');
    } else if (action === 'new') newSession();
    else if (action === 'home' || action === 'files' || action === 'apps' || action === 'machine') move(action);
  }

  onMount(() => {
    const viewport = window.visualViewport;
    const update = () => {
      if (viewport) keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    };
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    update();

    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        commandOpen = !commandOpen;
      } else if (event.key === 'Escape') {
        commandOpen = false;
        navOpen = false;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<svelte:head>
  <title>Pocket-T — Your workspace, everywhere</title>
  <meta name="theme-color" content={section === 'terminals' ? '#171c35' : '#f7f7fb'}/>
  <meta name="description" content="One beautiful interface for your live Mac sessions, files and applications. Fully useful without AI."/>
</svelte:head>

<div class="studio" class:terminal-mode={section === 'terminals'} style:padding-bottom={section === 'terminals' ? keyboardInset + 'px' : '0px'}>
  {#if navOpen}<button class="nav-backdrop" onclick={() => (navOpen = false)} aria-label="Close navigation"></button>{/if}

  <aside class:opened={navOpen} class="rail" aria-label="Main navigation">
    <button class="brand" onclick={() => move('home')} aria-label="Pocket-T home">
      <span class="brand-mark"><span class="brand-core"></span><span class="brand-shine"></span></span>
      <span class="brand-label">pocket<span class="brand-accent">.</span>t<small>YOUR REMOTE WORKSPACE</small></span>
    </button>

    <div class="rail-group-label">WORKSPACE</div>
    <nav class="rail-links" aria-label="Workspaces">
      {#each primary as entry (entry.key)}
        <button class:active={section === entry.key} onclick={() => move(entry.key)}>
          <Icon name={entry.icon} size={19}/>
          <span>{entry.name}</span>
          {#if entry.key === 'terminals' && $sessions.length}<small>{$sessions.length}</small>{/if}
        </button>
      {/each}
    </nav>

    <div class="rail-group-label utility-heading">TOOLS & PREFERENCES</div>
    <nav class="rail-links">
      <button class:active={section === 'vault'} onclick={() => move('vault')}><Icon name="vault" size={19}/><span>Vault & values</span><small class="tag">SOON</small></button>
      <button onclick={() => { commandOpen = true; navOpen = false; }}><Icon name="search" size={19}/><span>Quick actions</span><small class="shortcut">⌘K</small></button>
    </nav>

    <div class="rail-blank"></div>
    <div class="device-panel">
      <span class="device-image"><Icon name="monitor" size={21}/></span>
      <span><strong>My Mac</strong><small>{connected ? 'Connected & ready' : 'Waiting to connect'}</small></span>
      <i class:offline={!connected}></i>
    </div>
    <div class="rail-caption"><Icon name="lock" size={13}/> Private workspace · No AI required</div>
  </aside>

  <main class="main">
    <header class="topbar">
      <div class="topbar-left">
        <button class="mobile-menu" onclick={() => (navOpen = true)} aria-label="Open navigation"><Icon name="menu" size={22}/></button>
        {#if section === 'terminals'}
          <button class="back" onclick={() => move('home')} aria-label="Back to overview"><Icon name="arrow-left" size={18}/></button>
        {/if}
        <div class="topbar-brand">pocket<span>.</span>t</div>
        <span class="topbar-divide"></span>
        <span class="topbar-section">{section === 'home' ? 'Overview' : section === 'terminals' ? 'Live session' : section === 'files' ? 'Your files' : section === 'apps' ? 'Applications' : section === 'vault' ? 'Vault & values' : 'Your Mac'}</span>
      </div>
      <div class="topbar-right">
        <div class="topbar-status"><span class:off={!connected}></span>{connected ? 'Mac online' : 'Mac offline'}</div>
        <button class="command-button" onclick={() => (commandOpen = true)} aria-label="Open quick actions"><Icon name="search" size={18}/><span>Search anything</span><kbd>⌘K</kbd></button>
        <button class="avatar" onclick={() => move('machine')} title="Machine details" aria-label="View connected Mac"><Icon name="machine" size={19}/></button>
      </div>
    </header>

    <div class="content" class:dark-content={section === 'terminals'}>
      {#if section === 'home'}
        <WorkspaceHome
          onOpenSession={openSession}
          onNewSession={newSession}
          onAllSessions={() => move('terminals')}
          onFiles={() => move('files')}
          onApps={() => move('apps')}
          onMachine={() => move('machine')}
        />
      {:else if section === 'terminals'}
        <TerminalWorkspace />
      {:else if section === 'files'}
        <FilesWorkspace/>
      {:else if section === 'apps'}
        <AppsWorkspace/>
      {:else if section === 'vault'}
        <VaultWorkspace/>
      {:else if section === 'machine'}
        <section class="machine-page">
          <span class="eyebrow">YOUR REMOTE MACHINE</span>
          <h1>My Mac<span>.</span></h1>
          <p>Everything your computer can do, within the permissions it already has.</p>
          <div class="machine-hero">
            <div class="machine-graphic"><Icon name="monitor" size={66}/></div>
            <div class="machine-copy">
              <span class="machine-kicker">YOUR DEVICE</span>
              <h2>Your Mac, within reach.</h2>
              <p>Real shells, existing tmux sessions, files and approved application launches. No AI services required.</p>
              <span class="machine-online"><i class:off={!connected}></i>{connected ? 'Connected and reachable' : 'Currently offline'}</span>
              <button onclick={() => move('terminals')}>Open live sessions <Icon name="arrow" size={17}/></button>
            </div>
          </div>
          <div class="capabilities">
            <button onclick={() => move('terminals')}><Icon name="terminal" size={21}/><strong>{activeCount} live sessions</strong><span>Join a real Mac terminal</span><Icon name="arrow" size={17}/></button>
            <button onclick={() => move('files')}><Icon name="folder" size={21}/><strong>File access</strong><span>Approved folders only</span><Icon name="arrow" size={17}/></button>
            <button onclick={() => move('apps')}><Icon name="apps" size={21}/><strong>App launcher</strong><span>Locally approved apps</span><Icon name="arrow" size={17}/></button>
          </div>
          <p class="boundary"><Icon name="lock" size={16}/> Screen control and credential filling are not active in this build. They're separate Mac capabilities requiring permission.</p>
        </section>
      {/if}
    </div>

    {#if section !== 'terminals'}
      <nav class="floating-nav" aria-label="Mobile navigation">
        {#each primary.slice(0,5) as item (item.key)}
          <button class:active={section === item.key} onclick={() => move(item.key)} aria-label={item.name} aria-current={section === item.key ? 'page' : undefined}>
            <span class="nav-ico"><Icon name={item.icon} size={21}/></span><span class="nav-name">{item.key === 'home' ? 'Home' : item.key === 'terminals' ? 'Sessions' : item.key === 'files' ? 'Files' : item.key === 'apps' ? 'Apps' : 'Mac'}</span>
          </button>
        {/each}
      </nav>
    {/if}
  </main>

  {#if commandOpen}
    <div class="palette-scrim" role="presentation" onclick={() => (commandOpen = false)}></div>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Pocket-T quick actions">
      <div class="palette-head"><Icon name="search" size={23}/><input bind:this={paletteInput} type="search" placeholder="Where do you want to go?" bind:value={commandQuery} aria-label="Search actions"/><button onclick={() => (commandOpen = false)} aria-label="Close quick actions"><Icon name="close" size={18}/></button></div>
      <div class="palette-group">QUICK ACTIONS</div>
      <div class="palette-items">
        {#each shownActions as action (action.id)}
          <button onclick={() => perform(action.id)} disabled={action.id === 'new' && !connected}>
            <span class="palette-icon"><Icon name={action.icon} size={19}/></span>
            <span><strong>{action.label}</strong><small>{action.detail}</small></span>
            <Icon name="chevron" size={17}/>
          </button>
        {/each}
        {#if !shownActions.length}<div class="palette-none">No matching actions</div>{/if}
      </div>
      <div class="palette-foot"><Icon name="lock" size={13}/> Commands run on your Mac only when you explicitly choose them.</div>
    </div>
  {/if}
</div>

<style>
  .studio{--violet:#7862e1;--ink:#262641;--muted:#8a8c9e;--line:#e8e7f0;--surface:#fff;display:flex;min-height:0;height:100dvh;width:100%;overflow:hidden;background:#f7f7fb;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .studio button{font-family:inherit;cursor:pointer}.studio button:focus-visible{outline:3px solid #987cff;outline-offset:3px}.studio button:disabled{cursor:not-allowed}
  .rail{position:relative;z-index:10;display:flex;flex-direction:column;width:232px;flex:none;background:linear-gradient(153deg,#fffffffa,#f5f4fb);padding:28px 15px 20px;border-right:1px solid #e9e8f3}
  .brand{display:flex;align-items:center;gap:12px;margin:1px 6px 52px;border:0;background:none;color:#292642;text-align:left;padding:0}
  .brand-mark{width:42px;height:42px;display:grid;place-items:center;border-radius:15px;position:relative;overflow:hidden;background:linear-gradient(143deg,#9991fa 8%,#735cde 65%,#b29aea 100%);box-shadow:0 7px 17px #6e5add38}
  .brand-core{height:19px;width:19px;transform:rotate(42deg);border-radius:6px 8px 6px 8px;background:#ffffffde;box-shadow:0 0 17px #fff8}
  .brand-shine{position:absolute;width:44px;height:12px;background:#fff5;filter:blur(13px);left:-10px;top:2px;transform:rotate(-35deg)}
  .brand-label{font-size:23px;font-weight:840;letter-spacing:-1.2px;line-height:1}.brand-accent,.topbar-brand span{color:#8771df}
  .brand-label small{display:block;color:#b1abbf;font-size:8px;letter-spacing:1.3px;font-weight:750;margin-top:6px}
  .rail-group-label{margin:0 15px 12px;font-size:9px;letter-spacing:1.7px;font-weight:800;color:#afadbd}.utility-heading{margin-top:39px}
  .rail-links{display:grid;gap:4px}.rail-links button{display:flex;align-items:center;gap:13px;min-height:45px;border:1px solid transparent;background:none;border-radius:12px;text-align:left;color:#8b8b9e;padding:0 14px;font-size:12px;font-weight:700;transition:background .17s,color .17s,transform .2s}
  .rail-links button:hover{background:#f2f0fb;color:#5a4da6;transform:translateX(2px)}
  .rail-links button.active{color:#7160d4;background:#eeebff;border-color:#e1ddff}
  .rail-links button>span{flex:1}.rail-links small{font-size:10px;color:#8977d6;padding:3px 7px;border-radius:7px;background:#e1dbfa}
  .rail-links .tag{font-size:8px;color:#afabbd;background:none;padding:0}.rail-links .shortcut{font-size:9px;color:#b7b4c6;background:none;padding:0}
  .rail-blank{flex:1}
  .device-panel{display:flex;align-items:center;gap:9px;min-height:68px;background:#fff;border:1px solid #e5e4ef;box-shadow:0 7px 18px #2a2e5808;border-radius:16px;padding:9px 11px}
  .device-image{width:40px;height:40px;display:grid;place-items:center;background:#eeebff;color:#7763dd;border-radius:12px}
  .device-panel>span:nth-child(2){flex:1;display:grid;gap:5px;min-width:0}.device-panel strong{font-size:11px}.device-panel small{font-size:9px;color:#9a9baa}
  .device-panel i,.topbar-status>span,.machine-online i{width:8px;height:8px;background:#56c3a0;border-radius:50%;box-shadow:0 0 0 4px #e4f7ee;flex:none}
  .device-panel i.offline,.topbar-status>span.off,.machine-online i.off{background:#c99ca7;box-shadow:0 0 0 4px #f9eaed}
  .rail-caption{color:#a4a3b2;font-size:9px;display:flex;gap:5px;align-items:center;justify-content:center;margin-top:16px}
  .main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
  .topbar{height:77px;min-height:77px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 37px;border-bottom:1px solid #eae9f3;background:#ffffffb3;backdrop-filter:blur(20px);z-index:2;gap:15px}
  .topbar-left,.topbar-right{display:flex;align-items:center;gap:13px}.topbar-brand{display:none}.topbar-divide{width:1px;height:18px;background:#e1deeb}.topbar-section{font-size:13px;color:#53536c;font-weight:730}
  .topbar-status{display:flex;align-items:center;gap:10px;font-size:11px;font-weight:680;color:#6f7584}.topbar-status>span{display:inline-block;width:7px;height:7px}
  .command-button{min-height:38px;display:flex;align-items:center;gap:9px;border:1px solid #eae9f1;background:#fff;border-radius:10px;padding:0 11px;color:#a3a0b4;font-size:11px;transition:box-shadow .2s}
  .command-button:hover{box-shadow:0 6px 17px #5a558e18}.command-button kbd{border:1px solid #ebebf2;border-radius:5px;padding:3px 4px;font-size:9px;color:#a9a5b6}
  .avatar{display:grid;place-items:center;width:39px;height:39px;background:#eae6ff;color:#7662d5;border-radius:12px;border:0}
  .content{flex:1;min-height:0;display:flex;overflow:hidden;background:radial-gradient(ellipse at 95% 0%,#ececff75,transparent 43%),#f8f8fc;animation:pageEnter .3s cubic-bezier(.22,1,.36,1)}
  .content.dark-content{background:#11172b}
  .mobile-menu{display:none}.nav-backdrop{display:none}
  .machine-page{flex:1;overflow-y:auto;width:100%;max-width:1150px;margin:auto;padding:48px clamp(22px,5vw,70px)}
  .machine-page>.eyebrow{color:#897ab5;font-size:10px;letter-spacing:1.8px;font-weight:800}
  .machine-page h1{font-size:47px;letter-spacing:-2px;margin:15px 0 8px}.machine-page h1 span{color:#8171dd}.machine-page>p{color:#898da0;font-size:14px;line-height:1.7}
  .machine-hero{border-radius:25px;display:flex;gap:35px;align-items:center;background:linear-gradient(130deg,#25274d,#5954b8);color:#fff;margin-top:30px;padding:38px;overflow:hidden}
  .machine-graphic{width:180px;height:157px;flex:none;border-radius:26px;display:grid;place-items:center;background:linear-gradient(140deg,#9496f6,#5847bd);box-shadow:inset 0 1px 0 #fff6,0 25px 40px #1513574d;color:#eeecff}
  .machine-copy h2{font-size:28px;letter-spacing:-1px;margin:9px 0}.machine-copy p{color:#d4d6f3;font-size:12px;line-height:1.8}
  .machine-kicker{color:#c4c8f6;font-size:9px;letter-spacing:1.6px;font-weight:800}
  .machine-online{display:flex;align-items:center;gap:9px;font-size:11px;font-weight:650;margin:20px 0}
  .machine-copy>button{display:flex;align-items:center;gap:9px;border:0;border-radius:11px;background:#fff;color:#44387c;padding:12px 17px;font-size:12px;font-weight:750}
  .capabilities{display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-top:16px}
  .capabilities button{display:grid;grid-template-columns:30px 1fr 20px;align-items:center;column-gap:8px;row-gap:5px;text-align:left;border:1px solid #eae9f5;background:#fff;border-radius:16px;padding:20px 15px}
  .capabilities button > :global(svg:first-child){grid-row:1/3;color:#7563d5}.capabilities strong{font-size:12px}.capabilities span{grid-column:2;font-size:10px;color:#8e91a1}.capabilities button > :global(svg:last-child){grid-column:3;grid-row:1/3;color:#a69ec7}
  .boundary{display:flex;gap:8px;align-items:start;color:#9294a5;font-size:11px;margin-top:23px}
  .floating-nav{display:none}
  .palette-scrim{position:fixed;inset:0;z-index:60;background:#12122a72;backdrop-filter:blur(7px)}
  .palette{position:fixed;top:min(16vh,160px);left:50%;transform:translateX(-50%);z-index:61;width:min(540px,calc(100vw - 34px));background:#fff;border:1px solid #e8e5f3;border-radius:22px;overflow:hidden;box-shadow:0 32px 90px #15133047;animation:paletteIn .25s cubic-bezier(.22,1,.36,1)}
  .palette-head{display:flex;align-items:center;gap:12px;padding:17px 18px;border-bottom:1px solid #f0eef7;color:#8771d9}.palette-head input{font:inherit;font-size:16px;flex:1;min-width:0;border:0;background:none;color:#252641;outline:none}
  .palette-head input::placeholder{color:#a3a3b5}.palette-head button{border:0;background:#f3f1fb;color:#8e8bab;width:32px;height:32px;border-radius:9px;display:grid;place-items:center}
  .palette-group{font-size:9px;color:#a6a2b7;letter-spacing:1.6px;font-weight:850;padding:18px 21px 8px}
  .palette-items{padding:0 10px 10px;max-height:55vh;overflow-y:auto}
  .palette-items button{display:flex;align-items:center;gap:13px;text-align:left;width:100%;border:0;background:none;border-radius:13px;padding:10px;color:#403e60;transition:background .18s,transform .18s}
  .palette-items button:hover{background:#f3f0ff;transform:translateX(3px)}
  .palette-icon{width:42px;height:42px;border-radius:12px;background:#eeebff;color:#7c6ce1;display:grid;place-items:center;flex:none}
  .palette-items button>span:nth-child(2){flex:1;display:grid;gap:4px}.palette-items strong{font-size:13px}.palette-items small{font-size:10px;color:#9693ad}
  .palette-none{color:#9896a7;font-size:13px;padding:20px}.palette-foot{background:#f7f6fb;border-top:1px solid #eceaf3;color:#9b9aaf;display:flex;align-items:center;gap:8px;font-size:10px;padding:13px 20px}
  @keyframes paletteIn{from{opacity:0;transform:translate(-50%,-9px) scale(.97)}to{opacity:1;transform:translate(-50%,0) scale(1)}}
  @keyframes pageEnter{from{opacity:.8;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
  @media(max-width:1000px){.rail{width:207px}.topbar{padding:0 22px}.capabilities{grid-template-columns:1fr}}
  @media(max-width:820px){
    .rail{position:fixed;inset:0 auto 0 0;width:min(82vw,306px);transform:translateX(-104%);transition:transform .3s cubic-bezier(.22,1,.36,1);z-index:51;padding-top:calc(env(safe-area-inset-top,0px) + 25px);box-shadow:0 0 50px #1a164d12}
    .rail.opened{transform:translateX(0)}.nav-backdrop{display:block;position:fixed;inset:0;background:#0d102b84;z-index:50;border:0}
    .topbar{height:calc(55px + env(safe-area-inset-top,0px));min-height:calc(55px + env(safe-area-inset-top,0px));padding:env(safe-area-inset-top,0px) 17px 0;background:#f8f8fcd9;backdrop-filter:blur(18px)}
    .mobile-menu{display:grid;place-items:center;width:39px;height:39px;border:0;background:none;color:#4f496b}
    .topbar-brand{display:block;color:#28263f;font-size:20px;font-weight:850;letter-spacing:-.9px}
    .topbar-divide{display:none}.topbar-section{display:none}.topbar-status{font-size:0;gap:0}.topbar-status>span{height:9px;width:9px}
    .command-button{display:none}.avatar{width:38px;height:38px}
    .content{padding-bottom:0}.content.dark-content{padding-bottom:0}
    .floating-nav{position:fixed;left:50%;bottom:calc(13px + env(safe-area-inset-bottom,0px));z-index:20;transform:translateX(-50%);display:flex;align-items:center;justify-content:space-around;gap:3px;width:min(440px,calc(100vw - 24px));height:68px;background:#fffffff0;backdrop-filter:blur(28px);border:1px solid #ffffffed;border-radius:23px;box-shadow:0 15px 45px #3c385329,0 2px 8px #48428a10;padding:6px 7px;animation:pageEnter .38s ease both}
    .floating-nav button{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;height:56px;border:0;border-radius:17px;background:none;color:#9a98ad;transition:background .25s,color .25s,transform .25s}
    .floating-nav button.active{background:#eeeaff;color:#7561d9}.floating-nav button:active{transform:scale(.93)}
    .floating-nav .nav-ico{height:23px;display:grid;place-items:center}.floating-nav .nav-name{font-size:9px;font-weight:750}
    .machine-page{padding:28px 18px 125px}.machine-page h1{font-size:36px}
    .machine-hero{display:block;padding:27px}.machine-graphic{width:100%;height:120px;margin-bottom:25px}
    .machine-copy h2{font-size:25px}.capabilities{grid-template-columns:1fr}
  }
  @media(hover:none){.rail-links button:hover,.palette-items button:hover{transform:none}}
  @media(prefers-reduced-motion:reduce){.rail,.floating-nav button,.palette-items button{transition:none}.content,.floating-nav,.palette{animation:none}}
</style>