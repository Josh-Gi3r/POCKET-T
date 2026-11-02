<script lang="ts">
  import { onMount } from 'svelte';
  import PTIcon from './components/PTIcon.svelte';
  import HomeWorkspace from './components/HomeWorkspace.svelte';
  import TerminalWorkspace from './components/TerminalWorkspace.svelte';
  import FilesWorkspace from './components/FilesWorkspace.svelte';
  import AppsWorkspace from './components/AppsWorkspace.svelte';
  import VaultWorkspace from './components/VaultWorkspace.svelte';
  import { status, sessions, attach } from './lib/store';

  type Section = 'home' | 'terminal' | 'files' | 'apps' | 'machine' | 'vault';
  const nav: { id: Section; name: string; icon: string }[] = [
    { id: 'home', name: 'Overview', icon: 'home' },
    { id: 'terminal', name: 'Workspaces', icon: 'layers' },
    { id: 'files', name: 'Files', icon: 'folder' },
    { id: 'apps', name: 'Applications', icon: 'apps' },
    { id: 'machine', name: 'My Mac', icon: 'laptop' },
  ];

  let section = $state<Section>('home');
  let theme = $state<'light' | 'dark'>('light');
  let navOpen = $state(false);
  let keyboardInset = $state(0);
  const connected = $derived($status === 'open');
  const activeSessions = $derived($sessions.filter((s) => !s.detached).length);
  const navCount = $derived($sessions.length);

  function navigate(next: Section): void {
    section = next;
    navOpen = false;
    try { localStorage.setItem('pt-last-workspace', next); } catch { /* private mode */ }
  }

  function openSession(id: string): void {
    attach(id);
    navigate('terminal');
  }

  function toggleTheme(): void {
    theme = theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('pt-theme', theme); } catch { /* private mode */ }
  }

  onMount(() => {
    // Preference persistence never changes terminal contents.
    try {
      const savedTheme = localStorage.getItem('pt-theme');
      if (savedTheme === 'dark' || savedTheme === 'light') theme = savedTheme;
      const remembered = localStorage.getItem('pt-last-workspace');
      if (remembered === 'terminal') section = 'terminal';
    } catch { /* defaults are usable without localStorage */ }

    // iOS visualViewport accounts for the on-screen keyboard. A keyboard
    // never obscures Pocket-T's terminal compose row.
    const vp = window.visualViewport;
    if (!vp) return;
    const update = () => { keyboardInset = Math.max(0, window.innerHeight - vp.height - vp.offsetTop); };
    vp.addEventListener('resize', update);
    vp.addEventListener('scroll', update);
    update();
    return () => {
      vp.removeEventListener('resize', update);
      vp.removeEventListener('scroll', update);
    };
  });
</script>

<svelte:head>
  <title>Pocket-T — Your space, your machine</title>
  <meta name="description" content="A beautifully connected workspace for real terminals, files and applications. AI optional." />
  <meta name="theme-color" content={theme === 'dark' ? '#0e1220' : '#f6f7fb'} />
</svelte:head>

<div class="pt-app" data-theme={theme} style:padding-bottom={keyboardInset + 'px'}>
  <div class="backdrop-ambient" aria-hidden="true"><span class="ambient-a"></span><span class="ambient-b"></span></div>

  {#if navOpen}
    <button class="drawer-scrim" aria-label="Close navigation" onclick={() => (navOpen = false)}></button>
  {/if}

  <aside class="sidebar" class:drawer-open={navOpen} aria-label="Main navigation">
    <div class="sidebar-top">
      <button class="brand" onclick={() => navigate('home')} aria-label="Pocket-T home">
        <span class="brand-symbol"><span class="brand-ring"></span><span class="brand-center">t</span></span>
        <span class="brand-type">pocket<span>.</span>t<small>CONNECTED WORKSPACE</small></span>
      </button>
      <button class="close-drawer pt-icon-button" aria-label="Close menu" onclick={() => (navOpen = false)}><PTIcon name="x" size={20}/></button>
    </div>
    <div class="sidebar-line"></div>

    <div class="sidebar-label">YOUR SPACE</div>
    <nav class="sidebar-links" aria-label="Workspaces">
      {#each nav as item (item.id)}
        <button
          class:nav-selected={section === item.id}
          aria-current={section === item.id ? 'page' : undefined}
          onclick={() => navigate(item.id)}
        >
          <span class="nav-svg"><PTIcon name={item.icon} size={20}/></span>
          <span class="nav-label">{item.name}</span>
          {#if item.id === 'terminal' && navCount > 0}<span class="nav-count">{navCount}</span>{/if}
        </button>
      {/each}
    </nav>

    <div class="sidebar-label sidebar-more">PREFERENCES</div>
    <nav class="sidebar-links">
      <button class:nav-selected={section === 'vault'} aria-current={section === 'vault' ? 'page' : undefined} onclick={() => navigate('vault')}>
        <span class="nav-svg"><PTIcon name="shield" size={20}/></span>
        <span class="nav-label">Vault & Values</span><span class="coming-soon">SOON</span>
      </button>
      <button onclick={toggleTheme} title="Change appearance">
        <span class="nav-svg"><PTIcon name={theme === 'light' ? 'moon' : 'sun'} size={20}/></span>
        <span class="nav-label">{theme === 'light' ? 'Dark appearance' : 'Light appearance'}</span>
      </button>
    </nav>

    <div class="sidebar-spacer"></div>
    <div class="sidebar-device">
      <div class="device-picture"><PTIcon name="laptop" size={23}/></div>
      <div class="device-name"><strong>My Mac</strong><span>{connected ? 'Connected' : $status === 'reconnecting' ? 'Reconnecting' : 'Offline'}</span></div>
      <span class="pt-status-dot" data-state={connected ? 'online' : 'offline'}></span>
    </div>
    <div class="sidebar-microcopy">Your computer, wherever life takes you.</div>
  </aside>

  <div class="page-frame">
    <header class="mobile-header">
      <button class="mobile-logo" onclick={() => navigate('home')} aria-label="Pocket-T home">
        <span class="mobile-mark">t</span><span>pocket<span class="logo-period">.</span>t</span>
      </button>
      <div class="mobile-header-end">
        <button class="mobile-machine-chip" onclick={() => navigate('machine')} aria-label={connected ? 'Mac connected' : 'Mac offline'}>
          <span class="pt-status-dot" data-state={connected ? 'online' : 'offline'}></span>
          <span>{connected ? 'My Mac' : 'Offline'}</span>
        </button>
        <button class="pt-icon-button header-menu" onclick={() => (navOpen = true)} aria-label="Open navigation"><PTIcon name="menu" size={22}/></button>
      </div>
    </header>

    <main class="page-content">
      {#if section === 'home'}
        <HomeWorkspace {navigate} onNavigate={navigate} onOpenSession={openSession} />
      {:else if section === 'terminal'}
        <TerminalWorkspace />
      {:else if section === 'files'}
        <FilesWorkspace />
      {:else if section === 'apps'}
        <AppsWorkspace />
      {:else if section === 'vault'}
        <VaultWorkspace />
      {:else if section === 'machine'}
        <div class="machine-workspace pt-card-enter">
          <div class="pt-eyebrow">YOUR DEVICES <span class="crumb-split">/</span> MY MAC</div>
          <h1>One machine.<br/><em>Endless possibility.</em></h1>
          <p class="machine-intro">A single connected computer, with its capabilities available whenever you need them.</p>

          <div class="machine-feature">
            <div class="machine-disc" aria-hidden="true"><span><PTIcon name="laptop" size={66} stroke={1.15}/></span></div>
            <div class="machine-details">
              <span class="machine-tag"><span class="pt-status-dot" data-state={connected ? 'online' : 'offline'}></span>{connected ? 'CONNECTED' : 'OFFLINE'}</span>
              <h2>My Mac</h2>
              <p>{connected ? 'Your terminal sessions are reachable. Work from anywhere, with no AI tokens required.' : 'The Mac companion isn’t connected. Live control resumes when an approved connection is available.'}</p>
              <button class="pt-primary" onclick={() => navigate('terminal')}>Open workspace <PTIcon name="arrowUpRight" size={17}/></button>
            </div>
          </div>
          <div class="capability-grid">
            <button class="capability pt-hover-lift" onclick={() => navigate('terminal')}><span><PTIcon name="terminal" size={22}/></span><strong>Terminals</strong><small>Live sessions, direct control</small><PTIcon name="arrowUpRight" size={17}/></button>
            <button class="capability pt-hover-lift" onclick={() => navigate('files')}><span><PTIcon name="folder" size={22}/></span><strong>Files</strong><small>Browse permitted folders</small><PTIcon name="arrowUpRight" size={17}/></button>
            <button class="capability pt-hover-lift" onclick={() => navigate('apps')}><span><PTIcon name="apps" size={22}/></span><strong>Applications</strong><small>Launch approved apps</small><PTIcon name="arrowUpRight" size={17}/></button>
          </div>
          <div class="capability-notice"><PTIcon name="info" size={19}/><span>Remote desktop and browser control require native permissions and are not yet enabled in this build. The interface will never pretend to control something it cannot.</span></div>
        </div>
      {/if}
    </main>

    {#if section !== 'terminal' && keyboardInset < 70}
      <nav class="mobile-dock" aria-label="Quick navigation">
        {#each [
          { id:'home' as Section,icon:'home',label:'Home' },
          { id:'terminal' as Section,icon:'layers',label:'Work' },
          { id:'files' as Section,icon:'folder',label:'Files' },
          { id:'machine' as Section,icon:'laptop',label:'Mac' },
        ] as item (item.id)}
          <button class:active={section === item.id} aria-current={section === item.id ? 'page' : undefined} onclick={() => navigate(item.id)} aria-label={item.label}>
            <span class="dock-icon"><PTIcon name={item.icon} size={20}/></span>
            <span>{item.label}</span>
          </button>
        {/each}
      </nav>
    {/if}
  </div>
</div>

<style>
  .pt-app { position:relative; display:flex; width:100%; height:100dvh; min-height:0; overflow:hidden; isolation:isolate; }
  .backdrop-ambient { position:absolute; inset:0; pointer-events:none; z-index:-1; overflow:hidden; }
  .ambient-a,.ambient-b { position:absolute; border-radius:50%; filter:blur(70px); }
  .ambient-a { height:380px;width:380px;right:8%;top:-235px;background:#aaa7ff27; }
  .ambient-b { height:400px;width:400px;left:19%;bottom:-330px;background:#b6dfec24; }
  .sidebar { display:flex; flex-direction:column; min-height:0; z-index:10; width:248px; flex:none; padding:26px 14px 19px; background:var(--pt-glass); border-right:1px solid var(--pt-line); backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px); }
  .sidebar-top { display:flex;justify-content:space-between;align-items:center;padding:2px 12px 3px; }
  .brand,.mobile-logo { display:flex;align-items:center;gap:12px;background:transparent;color:var(--pt-ink);padding:0;text-align:left; }
  .brand-symbol { position:relative;height:40px;width:40px;display:grid;place-items:center;border-radius:15px; background:linear-gradient(140deg,#8986ff,#695adf 65%,#3b53c7);box-shadow:0 9px 22px #655de447; flex:none; overflow:hidden; }
  .brand-symbol:after { content:'';position:absolute;top:-18px;left:13px;width:22px;height:58px;background:#ffffff4c;filter:blur(12px);transform:rotate(38deg); }
  .brand-ring { position:absolute;border:1px solid #ffffff7c;border-radius:10px;width:27px;height:27px;transform:rotate(-19deg); }
  .brand-center { position:relative;z-index:1;font-size:26px;line-height:1;font-weight:750;color:white;letter-spacing:-2px; }
  .brand-type { font-size:22px;font-weight:760;letter-spacing:-1.25px;line-height:1; }
  .brand-type>span {color:var(--pt-violet);}
  .brand-type small {display:block;font-size:8px;font-weight:730;letter-spacing:1.5px;color:var(--pt-tertiary);margin-top:5px;}
  .close-drawer {display:none!important;}
  .sidebar-line {height:1px;background:var(--pt-line);margin:28px 10px 23px;}
  .sidebar-label {color:var(--pt-tertiary);font-size:10px;font-weight:760;letter-spacing:1.2px;margin:0 15px 12px;}
  .sidebar-label.sidebar-more {margin-top:34px;}
  .sidebar-links {display:flex;flex-direction:column;gap:4px;}
  .sidebar-links button {display:flex;align-items:center;gap:13px;border-radius:13px;min-height:46px;width:100%;background:transparent;color:var(--pt-secondary);padding:0 13px;text-align:left;border:1px solid transparent;font-size:13px;font-weight:650;position:relative;}
  .sidebar-links button:hover {background:var(--pt-surface-soft);color:var(--pt-ink);}
  .sidebar-links button.nav-selected {color:var(--pt-violet);background:var(--pt-violet-soft);font-weight:750;}
  .sidebar-links button.nav-selected:before {content:'';position:absolute;left:-14px;top:12px;bottom:12px;width:3px;background:var(--pt-violet);border-radius:0 5px 5px 0;}
  .nav-svg {display:grid;place-items:center;width:25px;flex:none;}
  .nav-label {flex:1;}
  .nav-count {font-weight:720;font-size:10px;display:grid;place-items:center;min-width:23px;height:22px;border-radius:8px;background:var(--pt-surface);}
  .coming-soon {font-size:8px;letter-spacing:.7px;color:var(--pt-tertiary);}
  .sidebar-spacer {flex:1;}
  .sidebar-device {display:flex;align-items:center;gap:11px;min-height:66px;padding:11px;background:var(--pt-surface);border:1px solid var(--pt-line);border-radius:17px;box-shadow:var(--pt-shadow-small);}
  .device-picture {height:37px;width:37px;display:grid;place-items:center;border-radius:12px;background:var(--pt-violet-soft);color:var(--pt-violet);}
  .device-name {flex:1;display:grid;gap:3px;min-width:0;}.device-name strong{font-size:12px;}.device-name span{font-size:10px;color:var(--pt-secondary);}
  .sidebar-microcopy {margin-top:15px;text-align:center;font-size:10px;color:var(--pt-tertiary);}
  .page-frame {display:flex;flex-direction:column;min-width:0;min-height:0;flex:1;}
  .page-content {display:flex;flex:1;min-height:0;position:relative;}
  .mobile-header,.mobile-dock,.drawer-scrim {display:none;}
  .machine-workspace {overflow-y:auto;flex:1;max-width:1200px;margin:0 auto;padding:48px clamp(26px,5vw,80px) 80px;}
  .crumb-split {margin:0 8px;color:var(--pt-line-strong);}
  .machine-workspace h1 {font-size:clamp(38px,4.5vw,62px);letter-spacing:-.057em;line-height:1.11;margin:20px 0 12px;font-weight:720;}
  .machine-workspace h1 em{color:var(--pt-violet);font-style:normal;font-weight:550;}
  .machine-intro{font-size:14px;line-height:1.65;color:var(--pt-secondary);max-width:535px;}
  .machine-feature {display:grid;grid-template-columns:39% 1fr;min-height:280px;margin-top:33px;border-radius:26px;background:linear-gradient(115deg,#29284e,#5354a0 75%,#737bc1);color:white;overflow:hidden;box-shadow:0 20px 40px #49498c25;}
  .machine-disc {display:grid;place-items:center;position:relative;background:radial-gradient(ellipse at 50% 50%,#b4affb33,transparent 70%);}
  .machine-disc:before{content:'';height:165px;width:165px;position:absolute;border-radius:50%;border:1px solid #ffffff45;box-shadow:0 0 0 28px #ffffff08,0 0 0 60px #ffffff06;}
  .machine-disc span {position:relative;z-index:1;display:grid;place-items:center;height:105px;width:105px;border-radius:28px;background:#ffffff2b;backdrop-filter:blur(20px);box-shadow:0 20px 38px #16144a33;}
  .machine-details {padding:42px 35px 33px;align-self:center;}.machine-details h2{font-size:30px;letter-spacing:-1.1px;margin:15px 0 8px;}.machine-details p{font-size:13px;max-width:385px;line-height:1.7;color:#e5e3ff;margin:0 0 20px;}
  .machine-tag {display:inline-flex;align-items:center;gap:8px;font-weight:760;letter-spacing:1px;font-size:10px;color:#f7f6ff;}
  .machine-details :global(.pt-primary){background:#fff;color:#38337f;box-shadow:none;}
  .machine-details :global(.pt-primary:hover){background:#f1f0ff;}
  .capability-grid {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;margin-top:22px;}
  .capability {display:grid;grid-template-columns:1fr auto;gap:8px;align-content:start;text-align:left;padding:23px;background:var(--pt-surface);border:1px solid var(--pt-line);border-radius:20px;color:var(--pt-ink);box-shadow:var(--pt-shadow-small);}
  .capability>span:first-child {grid-column:1/-1;display:grid;place-items:center;width:43px;height:43px;border-radius:14px;background:var(--pt-violet-soft);color:var(--pt-violet);margin-bottom:9px;}
  .capability strong{grid-column:1;font-size:13px;}.capability small{grid-column:1;color:var(--pt-secondary);font-size:11px;}.capability>svg{grid-column:2;grid-row:2;color:var(--pt-tertiary);}
  .capability-notice{margin-top:20px;display:flex;align-items:center;gap:10px;color:var(--pt-secondary);font-size:12px;line-height:1.7;}.capability-notice svg{color:var(--pt-violet);flex:none;}
  @media(max-width:900px){
    .sidebar {position:fixed;inset:0 auto 0 0;width:min(82vw,320px);height:100dvh;z-index:48;transform:translateX(-103%);transition:transform 350ms var(--pt-ease-out);box-shadow:var(--pt-shadow-float);padding-top:calc(env(safe-area-inset-top,0px) + 24px);background:var(--pt-surface);}
    .sidebar.drawer-open{transform:translateX(0);}
    .close-drawer {display:grid!important;}
    .drawer-scrim {display:block;position:fixed;inset:0;background:rgba(15,18,41,.36);z-index:47;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);animation:scrim-on 230ms ease;}
    .mobile-header {height:calc(62px + env(safe-area-inset-top,0px));flex:none;display:flex;align-items:center;justify-content:space-between;padding:env(safe-area-inset-top,0px) 19px 0;background:var(--pt-glass);border-bottom:1px solid var(--pt-line);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);z-index:11;}
    .mobile-logo{font-weight:770;font-size:20px;letter-spacing:-1px;gap:9px;}
    .mobile-mark{display:grid;place-items:center;width:31px;height:31px;border-radius:10px;background:linear-gradient(140deg,#9891ff,#6557df);color:#fff;font-size:21px;box-shadow:0 5px 14px #5b50d938;}
    .logo-period{color:var(--pt-violet);}
    .mobile-header-end{display:flex;align-items:center;gap:6px;}
    .mobile-machine-chip{display:inline-flex;align-items:center;gap:9px;padding:0 10px;min-height:37px;border:1px solid var(--pt-line);border-radius:12px;background:var(--pt-surface);color:var(--pt-secondary);font-size:11px;font-weight:700;}
    .header-menu{width:43px!important;height:43px!important;}
    .mobile-dock{position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 13px);left:50%;transform:translateX(-50%);z-index:30;display:flex;align-items:center;justify-content:space-around;gap:5px;width:min(calc(100% - 32px),408px);padding:8px;background:var(--pt-glass);border:1px solid var(--pt-line-strong);border-radius:23px;backdrop-filter:blur(30px) saturate(135%);-webkit-backdrop-filter:blur(30px) saturate(135%);box-shadow:var(--pt-shadow-float);}
    .mobile-dock button{flex:1;min-height:51px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px;border-radius:16px;background:transparent;color:var(--pt-secondary);font-size:10px;font-weight:650;}
    .mobile-dock button.active{background:var(--pt-violet-soft);color:var(--pt-violet);font-weight:780;}
    .dock-icon {display:grid;place-items:center;height:21px;}
    .mobile-dock button:not(.active):hover {background:var(--pt-surface-soft);}
    .machine-workspace {padding:29px 19px 126px;}
    .machine-feature {grid-template-columns:1fr;}.machine-disc{min-height:180px;}.machine-details{padding:20px 25px 28px;}
    .capability-grid{grid-template-columns:1fr;}
    @keyframes scrim-on {from{opacity:0}to{opacity:1}}
  }
  @media(prefers-reduced-motion:reduce) {.sidebar{transition:none}.drawer-scrim{animation:none}}
</style>