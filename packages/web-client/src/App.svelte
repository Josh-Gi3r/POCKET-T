<script lang="ts">
  import { onMount } from 'svelte';
  import UiIcon from './components/UiIcon.svelte';
  import ControlHome from './components/ControlHome.svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import TerminalWorkspace from './components/TerminalWorkspace.svelte';
  import FilesWorkspace from './components/FilesWorkspace.svelte';
  import AppsWorkspace from './components/AppsWorkspace.svelte';
  import VaultWorkspace from './components/VaultWorkspace.svelte';
  import { status, sessions, spawnState, current, attach, spawnSession } from './lib/store';

  type Section = 'home' | 'terminals' | 'files' | 'apps' | 'vault' | 'machine';
  let section = $state<Section>('home');
  let navOpen = $state(false);
  let commandOpen = $state(false);
  let theme = $state<'light' | 'dark'>('light');
  let keyboardInset = $state(0);
  let toast = $state('');

  const online = $derived($status === 'open');
  const activeSessions = $derived($sessions.filter((s) => !s.detached).length);
  const isWorkMode = $derived(section === 'terminals');

  function notify(message: string): void {
    toast = message;
    window.setTimeout(() => {
      if (toast === message) toast = '';
    }, 3300);
  }

  function navigate(next: Section): void {
    navOpen = false;
    commandOpen = false;
    if (section === next) return;
    const doc = document as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> };
    };
    if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      doc.startViewTransition(() => { section = next; });
    } else {
      section = next;
    }
  }

  function enterSession(sessionId: string): void {
    attach(sessionId);
    navigate('terminals');
  }

  function newTerminal(): void {
    if (!online) {
      notify('Your Mac is offline. Connect to start a terminal.');
      return;
    }
    if ($spawnState.status === 'starting') {
      notify('Your terminal is already starting.');
      navigate('terminals');
      return;
    }
    spawnSession();
    navigate('terminals');
  }

  function toggleTheme(): void {
    theme = theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('pt-ui-theme', theme); } catch { /* Private mode */ }
  }

  onMount(() => {
    try {
      const savedTheme = localStorage.getItem('pt-ui-theme');
      if (savedTheme === 'dark' || savedTheme === 'light') theme = savedTheme;
    } catch { /* Private mode */ }

    const viewport = window.visualViewport;
    if (viewport) {
      const update = () => {
        keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      };
      viewport.addEventListener('resize', update);
      viewport.addEventListener('scroll', update);
      update();

      // Attach shortcuts and remove them when the app is unmounted.
      const key = (event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          commandOpen = !commandOpen;
        } else if (event.key === 'Escape' && !commandOpen && navOpen) {
          navOpen = false;
        }
      };
      window.addEventListener('keydown', key);
      return () => {
        viewport.removeEventListener('resize', update);
        viewport.removeEventListener('scroll', update);
        window.removeEventListener('keydown', key);
      };
    }
    return;
  });
</script>

<svelte:head>
  <title>Pocket-T — Control without distance</title>
  <meta name="theme-color" content={theme === 'dark' ? '#101321' : '#f7f8ff'}/>
  <meta name="description" content="Your computer, running work, and real terminals in one beautiful remote workspace. Fully usable without AI."/>
</svelte:head>

<div class="pt-shell" data-theme={theme} class:focus-mode={isWorkMode} style:padding-bottom={keyboardInset + 'px'}>
  <div class="ambient atmosphere-a"></div>
  <div class="ambient atmosphere-b"></div>
  <div class="mesh-texture"></div>

  {#if navOpen}
    <button class="drawer-scrim" aria-label="Close navigation" onclick={() => (navOpen = false)}></button>
  {/if}

  <aside class="sidebar" class:open={navOpen} aria-label="Primary navigation">
    <button class="brand" onclick={() => navigate('home')} aria-label="Pocket-T home">
      <span class="brand-mark"><UiIcon name="sparkle" size={24} strokeWidth={1.55}/></span>
      <span class="brand-wordmark">pocket<span>·</span>t<small>CONTROL SPACE</small></span>
    </button>

    <div class="nav-label">YOUR SPACE</div>
    <nav class="side-links" aria-label="Workspaces">
      <button class:active={section === 'home'} onclick={() => navigate('home')}>
        <UiIcon name="grid" size={19}/><span>Overview</span>
      </button>
      <button class:active={section === 'terminals'} onclick={() => navigate('terminals')}>
        <UiIcon name="terminal" size={19}/><span>Live sessions</span>
        {#if $sessions.length}<span class="nav-count">{$sessions.length}</span>{/if}
      </button>
      <button class:active={section === 'files'} onclick={() => navigate('files')}>
        <UiIcon name="files" size={19}/><span>Files</span>
      </button>
      <button class:active={section === 'apps'} onclick={() => navigate('apps')}>
        <UiIcon name="apps" size={19}/><span>Applications</span>
      </button>
      <button class:active={section === 'machine'} onclick={() => navigate('machine')}>
        <UiIcon name="computer" size={19}/><span>My Mac</span>
      </button>
    </nav>

    <div class="nav-label utilities">PERSONAL TOOLS</div>
    <nav class="side-links">
      <button class:active={section === 'vault'} onclick={() => navigate('vault')}>
        <UiIcon name="lock" size={19}/><span>Vault & Values</span><span class="planning">SOON</span>
      </button>
    </nav>

    <div class="sidebar-bottom">
      <button class="quick-command" onclick={() => {commandOpen = true; navOpen = false;}}>
        <span class="command-symbol"><UiIcon name="command" size={18}/></span>
        <span>Quick command</span>
        <kbd>⌘K</kbd>
      </button>
      <div class="machine-card">
        <div class="mac-symbol"><UiIcon name="computer" size={21}/></div>
        <div class="machine-info"><strong>Your Mac</strong><span>{online ? 'Connected' : $status === 'reconnecting' ? 'Reconnecting' : 'Offline'}</span></div>
        <span class:offline={!online} class="presence"></span>
      </div>
      <p>Made for the way you actually work.</p>
    </div>
  </aside>

  <div class="application">
    <header class="topbar">
      <button class="mobile-back" onclick={() => isWorkMode ? navigate('home') : (navOpen = true)} aria-label={isWorkMode ? 'Back to overview' : 'Open navigation'}>
        {#if isWorkMode}<UiIcon name="chevron-left" size={22}/>{:else}<UiIcon name="menu" size={22}/>{/if}
      </button>
      <div class="breadcrumb"><span>POCKET-T</span><UiIcon name="chevron-right" size={13}/><strong>{section === 'home' ? 'Overview' : section === 'terminals' ? 'Live sessions' : section === 'files' ? 'Files' : section === 'apps' ? 'Applications' : section === 'machine' ? 'My Mac' : 'Vault'}</strong></div>
      <button class="mobile-brand" onclick={() => navigate('home')} aria-label="Pocket-T overview">pocket<span>·</span>t</button>
      <div class="topbar-actions">
        {#if !isWorkMode}
          <span class:offline={!online} class="top-presence"><span></span>{online ? 'Mac online' : 'Mac offline'}</span>
        {/if}
        <button class="top-icon search-top" onclick={() => (commandOpen = true)} aria-label="Open command palette" title="Search anything"><UiIcon name="search" size={20}/></button>
        <button class="top-icon theme-top" onclick={toggleTheme} aria-label={theme === 'dark' ? 'Use light appearance' : 'Use dark appearance'} title="Switch appearance"><UiIcon name={theme === 'dark' ? 'sun' : 'moon'} size={19}/></button>
        <span class="user-avatar" title="Your workspace"><UiIcon name="sparkle" size={18}/></span>
      </div>
    </header>

    <main class="surface" class:terminal-surface={isWorkMode}>
      {#if section === 'home'}
        <ControlHome
          onNavigate={navigate}
          onOpenSession={enterSession}
          onNewTerminal={newTerminal}
          onCommand={() => (commandOpen = true)}
        />
      {:else if section === 'terminals'}
        <TerminalWorkspace />
      {:else if section === 'files'}
        <FilesWorkspace />
      {:else if section === 'apps'}
        <AppsWorkspace />
      {:else if section === 'vault'}
        <VaultWorkspace />
      {:else if section === 'machine'}
        <section class="computer-page">
          <div class="computer-eyebrow">YOUR MACHINE / CONNECTED SPACE</div>
          <h1>Always within <em>reach.</em></h1>
          <div class="computer-glass">
            <div class="computer-art"><span><UiIcon name="computer" size={57} strokeWidth={1.15}/></span></div>
            <div class="computer-copy"><span class:offline={!online} class="computer-status"><i></i>{online ? 'Connection active' : 'Currently offline'}</span><h2>Your Mac</h2><p>Real terminals, approved files and applications. Everything you can access is governed by the Mac's own permissions.</p><button onclick={() => navigate('terminals')}>Enter live session <UiIcon name="arrow-up-right" size={17}/></button></div>
          </div>
          <div class="computer-note"><UiIcon name="lock" size={19}/><span>Remote screen control and passwords require separately permitted native capabilities. They are not enabled in this build.</span></div>
        </section>
      {/if}
    </main>

    {#if !isWorkMode}
      <nav class="bottom-dock" aria-label="Mobile navigation">
        <button class:active={section === 'home'} onclick={() => navigate('home')} aria-label="Overview"><UiIcon name="grid" size={21}/><span>Home</span></button>
        <button class:active={section === 'terminals'} onclick={() => navigate('terminals')} aria-label="Terminals"><UiIcon name="terminal" size={21}/><span>Sessions</span></button>
        <button class:active={section === 'files'} onclick={() => navigate('files')} aria-label="Files"><UiIcon name="files" size={21}/><span>Files</span></button>
        <button class:active={section === 'apps'} onclick={() => navigate('apps')} aria-label="Applications"><UiIcon name="apps" size={21}/><span>Apps</span></button>
        <button class="dock-more" onclick={() => (navOpen = true)} aria-label="More workspaces"><UiIcon name="more" size={21}/><span>More</span></button>
      </nav>
    {/if}
  </div>

  {#if commandOpen}
    <CommandPalette
      onDismiss={() => (commandOpen = false)}
      onNavigate={navigate}
      onOpenSession={enterSession}
      onNewTerminal={newTerminal}
    />
  {/if}
  {#if toast}<div class="notice" role="status">{toast}</div>{/if}
</div>

<style>
  .pt-shell{
    --pt-bg:#f7f8fe;--pt-text:#171b34;--pt-secondary:#68738b;--pt-muted:#8e98ad;--pt-accent:#615cf0;--pt-accent-border:#b7b5fb;
    --pt-glass:rgba(255,255,255,.81);--pt-popover:#fff;--pt-line:rgba(52,65,114,.10);--pt-subtle:rgba(100,110,200,.08);
    position:relative;display:flex;height:100dvh;width:100%;overflow:hidden;background:var(--pt-bg);color:var(--pt-text);
    font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;isolation:isolate;
  }
  .pt-shell[data-theme="dark"]{
    --pt-bg:#101321;--pt-text:#f2f3fc;--pt-secondary:#b3bad2;--pt-muted:#858eaa;--pt-accent:#a6a0ff;--pt-accent-border:#6662ac;
    --pt-glass:rgba(32,38,63,.75);--pt-popover:#1a2033;--pt-line:rgba(193,203,255,.13);--pt-subtle:rgba(154,146,255,.12)
  }
  .ambient{position:absolute;z-index:-2;pointer-events:none;filter:blur(38px)}
  .atmosphere-a{height:600px;width:800px;top:-240px;right:-140px;background:radial-gradient(circle,#e9e6ffb0,transparent 65%)}
  .atmosphere-b{height:630px;width:670px;bottom:-360px;left:6%;background:radial-gradient(circle,#dff5fd86,transparent 62%)}
  .pt-shell[data-theme="dark"] .atmosphere-a{opacity:.16}.pt-shell[data-theme="dark"] .atmosphere-b{opacity:.09}
  .mesh-texture{pointer-events:none;position:absolute;inset:0;z-index:-1;background-image:radial-gradient(#9299bc22 .5px,transparent .5px);background-size:20px 20px;opacity:.34}
  button{font-family:inherit;cursor:pointer}
  button:disabled{cursor:not-allowed}
  button:focus-visible{outline:3px solid var(--pt-accent);outline-offset:3px}
  .sidebar{width:246px;flex:none;z-index:25;display:flex;flex-direction:column;min-height:0;background:var(--pt-glass);border-right:1px solid var(--pt-line);padding:31px 16px 19px;backdrop-filter:blur(35px);-webkit-backdrop-filter:blur(35px)}
  .brand{display:flex;gap:12px;align-items:center;text-align:left;color:var(--pt-text);background:transparent;border:0;padding:0 10px;margin-bottom:63px}
  .brand-mark{width:42px;height:42px;display:grid;place-items:center;background:linear-gradient(135deg,#7a66f9,#4866f3);color:#fff;border-radius:15px;box-shadow:0 8px 20px #6a62ee3c}
  .brand-wordmark{font-size:23px;line-height:1;font-weight:830;letter-spacing:-1.1px}.brand-wordmark>span{color:var(--pt-accent)}
  .brand-wordmark small{font-size:8px;letter-spacing:2.3px;font-weight:800;display:block;margin-top:6px;color:var(--pt-muted)}
  .nav-label{color:var(--pt-muted);font-size:9px;letter-spacing:1.7px;font-weight:820;margin:0 13px 13px}
  .nav-label.utilities{margin-top:36px}
  .side-links{display:grid;gap:5px}
  .side-links button{position:relative;display:flex;align-items:center;gap:12px;padding:13px 13px;min-height:49px;color:var(--pt-secondary);font-size:12px;font-weight:660;text-align:left;background:transparent;border:1px solid transparent;border-radius:13px;transition:background .23s,transform .28s cubic-bezier(.2,1,.3,1),color .25s}
  .side-links button>span:nth-child(2){flex:1}
  .side-links button:hover{color:var(--pt-text);background:var(--pt-subtle);transform:translateX(2px)}
  .side-links button.active{color:var(--pt-accent);background:var(--pt-subtle);border-color:var(--pt-line);font-weight:790}
  .side-links button.active:before{content:"";width:3px;height:20px;border-radius:3px;background:var(--pt-accent);position:absolute;left:-8px}
  .nav-count{background:var(--pt-accent);color:#fff;padding:3px 7px;border-radius:7px;font-size:10px}
  .planning{font-size:8px;letter-spacing:.7px;color:var(--pt-muted);font-weight:800}
  .sidebar-bottom{margin-top:auto}
  .quick-command{display:flex;align-items:center;gap:9px;padding:13px 11px;border-radius:13px;border:1px solid var(--pt-line);background:var(--pt-glass);color:var(--pt-secondary);width:100%;font-size:11px;text-align:left}
  .quick-command>span:nth-child(2){flex:1}.command-symbol{color:var(--pt-accent)}
  .quick-command kbd{font-size:9px;font-family:inherit;background:var(--pt-subtle);border:1px solid var(--pt-line);padding:5px 6px;border-radius:5px}
  .machine-card{display:flex;align-items:center;gap:10px;padding:13px 10px;background:var(--pt-subtle);border:1px solid var(--pt-line);border-radius:15px;margin-top:14px}
  .mac-symbol{height:35px;width:35px;display:grid;place-items:center;background:var(--pt-glass);color:var(--pt-accent);border:1px solid var(--pt-line);border-radius:12px}
  .machine-info{flex:1;display:grid;gap:4px;min-width:0}.machine-info strong{font-size:12px}.machine-info>span{font-size:10px;color:var(--pt-muted)}
  .presence{width:8px;height:8px;border-radius:50%;background:#50bc9b;box-shadow:0 0 0 4px #50bc9b1a}
  .presence.offline{background:#caa29a;box-shadow:none}
  .sidebar-bottom>p{font-size:9px;color:var(--pt-muted);text-align:center;margin:17px 0 0}
  .application{min-width:0;display:flex;flex:1;flex-direction:column;position:relative}
  .topbar{height:80px;display:flex;justify-content:space-between;align-items:center;padding:0 clamp(24px,4.8vw,74px);border-bottom:1px solid var(--pt-line);background:var(--pt-glass);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);flex:none;z-index:15}
  .breadcrumb{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--pt-muted)}
  .breadcrumb span{letter-spacing:1.25px;font-weight:800}.breadcrumb strong{font-size:12px;color:var(--pt-text);font-weight:700}
  .topbar-actions{display:flex;align-items:center;gap:11px}
  .top-presence{font-size:10px;color:var(--pt-secondary);font-weight:730;display:flex;align-items:center;gap:8px;margin-right:12px}
  .top-presence span{height:7px;width:7px;border-radius:50%;background:#49b69b;box-shadow:0 0 0 4px #4ab69a22}
  .top-presence.offline span{background:#c99e96;box-shadow:none}
  .top-icon{background:var(--pt-glass);border:1px solid var(--pt-line);color:var(--pt-secondary);height:41px;width:41px;border-radius:13px;display:grid;place-items:center;transition:transform .2s,background .2s,border-color .2s}
  .top-icon:hover{transform:translateY(-2px);color:var(--pt-accent);border-color:var(--pt-accent-border)}
  .user-avatar{margin-left:5px;display:grid;place-items:center;height:38px;width:38px;border-radius:50%;background:linear-gradient(135deg,#d6d0ff,#b4c6ff);color:#5754bd;border:2px solid var(--pt-glass)}
  .mobile-back,.mobile-brand{display:none}
  .surface{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0}
  .surface.terminal-surface{background:#0c1421}
  .bottom-dock,.drawer-scrim{display:none}
  .computer-page{flex:1;overflow:auto;padding:clamp(25px,4vw,55px);max-width:1050px;margin:auto;width:100%}
  .computer-eyebrow{font-size:10px;letter-spacing:1.8px;color:var(--pt-accent);font-weight:800}
  .computer-page h1{font-size:clamp(37px,5vw,58px);letter-spacing:-2px;margin:15px 0 33px;font-weight:730}
  .computer-page h1 em{color:var(--pt-accent);font-style:normal}
  .computer-glass{display:flex;align-items:center;gap:33px;background:var(--pt-glass);border:1px solid var(--pt-line);padding:31px;border-radius:26px}
  .computer-art{height:197px;width:250px;flex:none;display:grid;place-items:center;border-radius:22px;background:linear-gradient(145deg,#302d80,#8e8ce8);position:relative;overflow:hidden}
  .computer-art:before{content:"";position:absolute;width:170px;height:170px;border-radius:50%;border:1px solid #fff5;box-shadow:0 0 0 27px #fff1,0 0 0 59px #fff1}
  .computer-art>span{z-index:1;height:105px;width:105px;display:grid;place-items:center;border:1px solid #fff8;border-radius:27px;background:#ffffff22;color:#fff;backdrop-filter:blur(15px)}
  .computer-copy{display:grid;justify-items:start;gap:12px}
  .computer-status{font-size:10px;color:#3a9a7b;display:flex;align-items:center;gap:8px;font-weight:800}.computer-status i{width:7px;height:7px;border-radius:50%;background:#58bea0}
  .computer-status.offline{color:#c18e86}.computer-status.offline i{background:#c18e86}
  .computer-copy h2{font-size:26px;margin:0}.computer-copy p{font-size:13px;line-height:1.85;color:var(--pt-secondary);margin:0}
  .computer-copy button{display:flex;align-items:center;gap:11px;border:0;border-radius:11px;background:var(--pt-accent);color:#fff;font-size:12px;font-weight:740;padding:12px 15px;margin-top:7px}
  .computer-note{display:flex;gap:12px;align-items:start;padding:20px;margin-top:19px;border:1px solid var(--pt-line);border-radius:16px;background:var(--pt-glass);color:var(--pt-secondary);font-size:12px;line-height:1.7}
  .computer-note svg{flex:none;color:var(--pt-accent)}
  .notice{z-index:350;position:fixed;left:50%;bottom:100px;transform:translateX(-50%);background:#27284f;color:#fff;padding:13px 18px;border-radius:13px;box-shadow:0 18px 48px #12143633;font-size:12px;font-weight:700;max-width:90vw;text-align:center}
  :global(::view-transition-old(root)),:global(::view-transition-new(root)){animation-duration:.27s;animation-timing-function:cubic-bezier(.16,1,.3,1)}
  @media(max-width:900px){
    .sidebar{position:fixed;inset:0 auto 0 0;height:100dvh;max-width:320px;width:82vw;z-index:80;transform:translateX(-103%);transition:transform .36s cubic-bezier(.18,1,.3,1);box-shadow:0 25px 90px #10132d22;padding-top:calc(env(safe-area-inset-top,0px) + 24px)}
    .sidebar.open{transform:translateX(0)}
    .drawer-scrim{display:block;position:fixed;inset:0;background:#10152b77;z-index:79;border:0;backdrop-filter:blur(6px)}
    .topbar{height:calc(64px + env(safe-area-inset-top,0px));padding:env(safe-area-inset-top,0px) 18px 0;justify-content:space-between}
    .breadcrumb{display:none}.mobile-back,.mobile-brand{display:flex}
    .mobile-back{height:42px;width:42px;align-items:center;justify-content:center;background:var(--pt-glass);border:1px solid var(--pt-line);border-radius:14px;color:var(--pt-text)}
    .mobile-brand{border:0;background:none;font-size:21px;font-weight:820;color:var(--pt-text);letter-spacing:-1px}
    .mobile-brand span{color:var(--pt-accent)}
    .topbar-actions{gap:8px}.top-presence,.theme-top{display:none}.search-top{width:41px;height:41px}
    .user-avatar{height:36px;width:36px;margin-left:0}
    .bottom-dock{position:absolute;z-index:35;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);left:50%;transform:translateX(-50%);display:flex;justify-content:space-between;width:calc(100% - 30px);max-width:490px;padding:8px 8px;background:var(--pt-popover);border:1px solid var(--pt-line);border-radius:22px;box-shadow:0 14px 45px #16174126;backdrop-filter:blur(30px);-webkit-backdrop-filter:blur(30px)}
    .bottom-dock button{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;height:50px;background:transparent;border:0;border-radius:15px;color:var(--pt-muted);font-size:9px;font-weight:730;transition:background .18s,color .18s,transform .18s}
    .bottom-dock button.active{background:var(--pt-subtle);color:var(--pt-accent)}
    .bottom-dock button:active{transform:scale(.95)}
    .computer-page{padding:30px 18px 130px}.computer-page h1{font-size:38px}.computer-glass{flex-direction:column;align-items:stretch;padding:20px}
    .computer-art{width:100%;height:155px}.computer-copy h2{font-size:23px}
  }
  @media(max-width:480px){
    .user-avatar{display:none}
    .pt-shell.focus-mode .topbar{height:calc(52px + env(safe-area-inset-top,0px));}
    .pt-shell.focus-mode .mobile-brand{font-size:18px}
  }
  @media(prefers-reduced-motion:reduce){
    .sidebar,.bottom-dock button,.top-icon,.side-links button{transition:none}
    :global(::view-transition-old(root)),:global(::view-transition-new(root)){animation-duration:.01ms}
  }
</style>
