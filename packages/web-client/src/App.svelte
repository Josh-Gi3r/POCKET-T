<script lang="ts">
  import TerminalWorkspace from './components/TerminalWorkspace.svelte';
  import FilesWorkspace from './components/FilesWorkspace.svelte';
  import AppsWorkspace from './components/AppsWorkspace.svelte';
  import VaultWorkspace from './components/VaultWorkspace.svelte';
  import { status, sessions } from './lib/store';

  type Section = 'terminals' | 'files' | 'apps' | 'vault' | 'machine';
  let section = $state<Section>('terminals');
  let navOpen = $state(false);
  const connected = $derived($status === 'open');

  function navigate(next: Section) {
    section = next;
    navOpen = false;
  }
</script>

<svelte:head>
  <title>Pocket-T — your terminal, anywhere</title>
  <meta name="theme-color" content="#0a1019" />
  <meta name="description" content="Join your live Mac terminal from your phone. A true persistent shell, no AI required." />
</svelte:head>

<div class="shell">
  {#if navOpen}
    <button class="nav-overlay" aria-label="Close navigation" onclick={() => (navOpen = false)}></button>
  {/if}

  <aside class="app-nav" class:nav-open={navOpen} aria-label="Pocket-T navigation">
    <button class="brand" onclick={() => navigate('terminals')} aria-label="Pocket-T terminals">
      <span class="logo">❯<i>_</i></span>
      <span class="name">pocket<span>-</span>t<small>YOUR MACHINE, ANYWHERE</small></span>
    </button>
    <div class="nav-caption">WORKSPACE</div>
    <nav class="nav-items" aria-label="Workspaces">
      <button class:active={section === 'terminals'} onclick={() => navigate('terminals')}>
        <span class="nav-symbol">▣</span> <span>Terminals</span> <small>{$sessions.length}</small>
      </button>
      <button class:active={section === 'files'} onclick={() => navigate('files')}>
        <span class="nav-symbol">▤</span> <span>Files</span>
      </button>
      <button class:active={section === 'apps'} onclick={() => navigate('apps')}>
        <span class="nav-symbol">◫</span> <span>Applications</span>
      </button>
      <button class:active={section === 'machine'} onclick={() => navigate('machine')}>
        <span class="nav-symbol">⌘</span> <span>My Mac</span>
      </button>
    </nav>

    <div class="nav-caption utilities">MORE</div>
    <nav class="nav-items">
      <button class:active={section === 'vault'} onclick={() => navigate('vault')}>
        <span class="nav-symbol">◇</span> <span>Vault & Values</span> <small class="planned">PLAN</small>
      </button>
    </nav>
    <div class="nav-spacer"></div>

    <div class="local-status">
      <span class="device-icon">⌘</span>
      <span class="device-text"><strong>My Mac</strong><small>{connected ? 'Connected' : $status === 'reconnecting' ? 'Reconnecting…' : 'Offline'}</small></span>
      <span class="led" class:offline={!connected}></span>
    </div>
    <div class="nav-footnote">A real terminal, not an AI simulation.</div>
  </aside>

  <main class="app-main">
    <header class="mobile-global">
      <button class="hamburger" aria-label="Open navigation" onclick={() => (navOpen = true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M4 7h16M4 12h16M4 17h16"></path>
        </svg>
      </button>
      <button class="mobile-logo" onclick={() => navigate('terminals')}>pocket<span>-</span>t</button>
      <span class="top-status"><i class:offline={!connected}></i>{connected ? 'LIVE' : 'OFFLINE'}</span>
    </header>

    {#if section === 'terminals'}
      <TerminalWorkspace />
    {:else if section === 'files'}
      <FilesWorkspace />
    {:else if section === 'apps'}
      <AppsWorkspace />
    {:else if section === 'vault'}
      <VaultWorkspace />
    {:else if section === 'machine'}
      <div class="machine-info">
        <div class="label">MACHINE / LOCAL MAC</div>
        <h1>Your Mac<span>.</span></h1>
        <div class="machine-panel">
          <div class="computer-art"><span>⌘</span></div>
          <div class="machine-details">
            <h2>Connected computer</h2>
            <p>Terminals, files and applications are separate capabilities of this same Mac. Each works within the user's macOS permissions.</p>
            <div class="machine-presence"><i class:offline={!connected}></i>{connected ? 'Terminal connection active' : 'Offline — remote operations unavailable'}</div>
            <button class="to-terminal" onclick={() => navigate('terminals')}>Open terminals →</button>
          </div>
        </div>
        <div class="machine-note">
          <strong>Remote desktop is not enabled yet.</strong>
          <p>Screen viewing, mouse and application automation require permissioned Mac-native integrations. Existing live shells work today without those capabilities or any AI tokens.</p>
        </div>
      </div>
    {/if}
  </main>
</div>

<style>
  .shell{display:flex;min-height:0;height:100dvh;width:100%;overflow:hidden;background:#0a111b;color:#e4edf2}
  .app-nav{position:relative;z-index:5;width:193px;flex:none;display:flex;flex-direction:column;padding:24px 11px 15px;background:linear-gradient(#0f1926,#0d1723);border-right:1px solid #283644}
  .brand{display:flex;align-items:center;text-align:left;gap:10px;background:none;border:0;color:white;margin:0 3px 48px;padding:3px}
  .logo{display:flex;justify-content:center;align-items:center;width:33px;height:33px;border-radius:10px;background:#a2efd0;color:#123e36;font-weight:850;font:800 18px ui-monospace,Menlo,monospace}
  .logo i{font-style:normal;color:#386d56}
  .name{font-size:19px;letter-spacing:-.9px;font-weight:800}.name>span,.mobile-logo>span{color:#9df1c5}
  .name small{display:block;margin-top:2px;letter-spacing:1px;color:#718d98;font-size:7px;font-weight:790}
  .nav-caption{color:#688794;font-size:9px;letter-spacing:1.8px;margin:0 15px 12px;font-weight:850}
  .nav-caption.utilities{margin-top:37px}
  .nav-items{display:grid;gap:3px}
  .nav-items button{display:flex;align-items:center;gap:10px;width:100%;padding:12px 13px;color:#93a9b5;background:none;border:1px solid transparent;border-radius:11px;text-align:left;font-size:12px;font-weight:650}
  .nav-items button>span:nth-child(2){flex:1}.nav-items button.active{background:#203438;border-color:#35594f;color:#caf5dd}
  .nav-items button:hover:not(.active){background:#162733;color:#d6e5ed}
  .nav-symbol{width:20px;font-size:19px;text-align:center;color:#7fa3ad}.nav-items button.active .nav-symbol{color:#abf5d1}
  .nav-items small{background:#253e3d;border-radius:7px;padding:3px 6px;color:#a7e6c8;font-size:9px}
  .nav-items small.planned{background:none;color:#6e8590;font-size:8px;padding:0}
  .nav-spacer{flex:1}
  .local-status{display:flex;align-items:center;gap:10px;padding:12px 10px;background:#182a35;border:1px solid #314550;border-radius:12px}
  .device-icon{height:29px;width:29px;display:grid;place-items:center;color:#bad9da;background:#28404b;border-radius:9px;font-size:17px}
  .device-text{flex:1;display:grid;gap:3px;min-width:0}.device-text strong{font-size:11px}.device-text small{font-size:10px;color:#8ca8b0}
  .led,.top-status i,.machine-presence i{width:7px;height:7px;border-radius:50%;background:#9ef2c4;display:inline-block;box-shadow:0 0 10px #a8f2c566}
  .led.offline,.top-status i.offline,.machine-presence i.offline{background:#d59b8a;box-shadow:none}
  .nav-footnote{text-align:center;font-size:9px;color:#526b7a;margin-top:16px}
  .app-main{display:flex;min-width:0;min-height:0;flex:1;flex-direction:column}
  .mobile-global,.nav-overlay{display:none}
  .machine-info{overflow:auto;flex:1;padding:42px clamp(22px,6vw,80px);max-width:1100px;width:100%;margin:auto}
  .label{font-size:10px;letter-spacing:1.6px;color:#7a9ca5;font-weight:800}
  .machine-info h1{font-size:42px;letter-spacing:-1.4px;margin:13px 0 28px}.machine-info h1 span{color:#a2eaca}
  .machine-panel{display:flex;align-items:center;gap:30px;border:1px solid #375c4f;border-radius:18px;padding:34px;background:linear-gradient(125deg,#1b3d3b,#132330)}
  .computer-art{width:155px;height:135px;flex:none;display:grid;place-items:center;background:linear-gradient(#294b48,#173037);border:1px solid #457061;border-radius:22px}
  .computer-art span{font-size:61px;color:#a9f0d1}
  .machine-details h2{margin:0 0 11px;font-size:22px}.machine-details p{max-width:470px;color:#9bb6bc;font-size:13px;line-height:1.8}
  .machine-presence{display:flex;align-items:center;gap:9px;color:#c4e4d4;font-size:11px;margin:18px 0}
  .to-terminal{border:1px solid #3a705d;background:#a8f4d0;color:#183a2e;font-size:12px;font-weight:770;border-radius:10px;padding:12px 17px}
  .machine-note{margin-top:20px;background:#14242f;border:1px solid #304750;border-radius:13px;padding:21px}.machine-note strong{font-size:13px}.machine-note p{color:#91a9b0;line-height:1.75;font-size:12px}
  @media(max-width:900px){
    .app-nav{position:fixed;inset:0 auto 0 0;z-index:45;width:min(80vw,290px);padding-top:calc(env(safe-area-inset-top,0px) + 21px);transform:translateX(-105%);transition:transform .24s}
    .app-nav.nav-open{transform:translateX(0)}
    .nav-overlay{display:block;position:fixed;inset:0;background:#000b;border:0;z-index:44}
    .mobile-global{height:calc(49px + env(safe-area-inset-top,0px));flex:none;display:flex;align-items:center;justify-content:space-between;padding:env(safe-area-inset-top,0px) 14px 0;background:#0c1723;border-bottom:1px solid #283a46}
    .hamburger{width:40px;height:38px;background:none;border:0;color:#c5dada;display:grid;place-items:center}
    .hamburger svg{width:21px;height:21px}.mobile-logo{background:none;border:0;color:#f3faf7;font-size:19px;font-weight:800;letter-spacing:-.7px}
    .top-status{display:flex;align-items:center;gap:7px;font-size:9px;font-weight:800;color:#b7e9d0;letter-spacing:1px;min-width:54px;justify-content:flex-end}
    .machine-info{padding:25px 18px}.machine-info h1{font-size:34px}.machine-panel{display:block;padding:21px}.computer-art{width:100%;height:100px;margin-bottom:22px}
  }
  @media(prefers-reduced-motion:reduce){.app-nav{transition:none}}
</style>
