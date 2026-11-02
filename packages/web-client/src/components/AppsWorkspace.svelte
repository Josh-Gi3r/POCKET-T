<script lang="ts">
  import PTIcon from './PTIcon.svelte';
  import { status, approvedApps, appLaunch, fetchApprovedApps, requestAppLaunch } from '../lib/store';

  let pendingId = $state('');
  let pendingBundle = $state('');
  let showSetup = $state(false);
  const connected = $derived($status === 'open');

  $effect(() => {
    if ($status === 'open') fetchApprovedApps();
  });

  function startApp(bundleId: string) {
    if (!connected || pendingId) return;
    pendingBundle = bundleId;
    pendingId = requestAppLaunch(bundleId);
  }

  $effect(() => {
    const result = $appLaunch;
    if (result && pendingId && result.requestId === pendingId) {
      pendingId = '';
      pendingBundle = '';
    }
  });

  const setupExample = `POCKET_T_ALLOWED_APPS='[{"name":"Safari","bundleId":"com.apple.Safari"},{"name":"Finder","bundleId":"com.apple.finder"}]'`;
</script>

<section class="apps">
  <div class="header">
    <span class="eyebrow">YOUR MAC <span>/</span> APPLICATIONS</span>
    <h1>Applications<span>.</span></h1>
    <p>Open approved apps remotely. Browser tabs and full desktop interaction will become available through separate, permissioned native or browser integrations.</p>
  </div>
  <div class="intro-card">
    <div class="intro-mark"><PTIcon name="laptop" size={27}/></div>
    <div><strong>{connected ? 'Your Mac is connected' : 'Your Mac is offline'}</strong>
      <p>{connected ? 'Only apps that were allowlisted locally on the Mac can be launched.' : 'Connect to your Mac before launching apps.'}</p></div>
    <span class="indicator" class:offline={!connected}></span>
  </div>

  <div class="section-head">
    <div><span>LOCALLY APPROVED</span><h2>Available applications</h2></div>
    <button onclick={() => fetchApprovedApps()} disabled={!connected}><PTIcon name="refresh" size={16}/> Refresh</button>
  </div>

  {#if $approvedApps.length}
    <div class="apps-list">
      {#each $approvedApps as app (app.bundleId)}
        <div class="app-card">
          <div class="app-icon">{app.name.slice(0, 1).toUpperCase()}</div>
          <div class="app-copy"><strong>{app.name}</strong><span>{app.bundleId}</span></div>
          <button class="launch" onclick={() => startApp(app.bundleId)} disabled={!connected || !!pendingId}>
            {pendingId && pendingBundle === app.bundleId ? 'Launching…' : 'Launch'} <PTIcon name="arrowUpRight" size={16}/>
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty">
      <span class="empty-icon"><PTIcon name="apps" size={35}/></span><strong>No approved apps configured</strong>
      <p>To launch apps remotely, configure a small, explicit allowlist on the Mac. Pocket-T never obtains permission to launch everything merely from opening this page.</p>
      <button onclick={() => (showSetup = !showSetup)}>{showSetup ? 'Hide setup' : 'See setup'} →</button>
    </div>
  {/if}
  {#if showSetup}
    <div class="setup">
      <span>EXAMPLE LOCAL DAEMON CONFIGURATION</span>
      <code>{setupExample}</code>
      <p>Set the environment variable in the Mac daemon's launch configuration and restart the daemon. Opening a restricted website remains subject to the browser and network's existing restrictions.</p>
    </div>
  {/if}

  {#if $appLaunch}
    <div class:failed={!$appLaunch.ok} class="receipt" role="status">
      <span>{$appLaunch.ok ? '✓' : '⚠'}</span> {$appLaunch.message}
    </div>
  {/if}

  <div class="future-grid">
    <div><div class="feature-icon"><PTIcon name="window" size={24}/></div><strong>Existing windows</strong><p>List windows and switch between them through a native macOS integration.</p><small>NOT ENABLED</small></div>
    <div><div class="feature-icon"><PTIcon name="compass" size={24}/></div><strong>Browser tabs</strong><p>Use a permitted extension or existing browser automation API for supported tabs.</p><small>NOT ENABLED</small></div>
    <div><div class="feature-icon"><PTIcon name="cursor" size={24}/></div><strong>Screen interaction</strong><p>With explicit Screen Recording and Accessibility grants, control permitted UI elements.</p><small>NOT ENABLED</small></div>
  </div>
  <div class="hint">Launching an application does not grant access to passwords, private tabs, locked windows, or protected macOS controls.</div>
</section>

<style>
  .apps{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:42px clamp(23px,4.7vw,76px) 110px;max-width:1260px;width:100%;margin:auto;color:var(--pt-ink);scrollbar-width:thin}
  .eyebrow,.section-head>div>span,.setup>span{font-size:10px;letter-spacing:1.2px;color:var(--pt-tertiary);font-weight:790}
  .eyebrow span{margin:0 9px;color:var(--pt-line-strong)}
  .header h1{font-size:clamp(34px,3.7vw,52px);letter-spacing:-.056em;font-weight:740;margin:16px 0 10px;line-height:1.16}
  .header h1 span{color:var(--pt-violet)}
  .header p{font-size:13px;line-height:1.7;color:var(--pt-secondary);max-width:625px;margin:0 0 29px}
  .intro-card{display:flex;align-items:center;gap:20px;min-height:135px;padding:27px 31px;background:linear-gradient(111deg,var(--pt-violet-soft),var(--pt-surface) 76%);border:1px solid var(--pt-line);border-radius:22px;box-shadow:var(--pt-shadow-small)}
  .intro-mark{height:65px;width:65px;border-radius:20px;display:grid;place-items:center;color:var(--pt-violet);background:var(--pt-surface);box-shadow:var(--pt-shadow-small);flex:none}
  .intro-card>div:nth-child(2){min-width:0;flex:1}
  .intro-card strong{font-size:17px;font-weight:750;letter-spacing:-.3px}
  .intro-card p{font-size:12px;color:var(--pt-secondary);line-height:1.7;max-width:470px;margin:8px 0 0}
  .indicator{height:9px;width:9px;background:#24b590;box-shadow:0 0 0 5px #23b59016;border-radius:50%;flex:none}
  .indicator.offline{background:#d3996b;box-shadow:0 0 0 5px #d3996b14}
  .section-head{display:flex;align-items:end;justify-content:space-between;gap:12px;margin:34px 0 17px}
  .section-head h2{font-size:24px;font-weight:730;letter-spacing:-.8px;margin:8px 0 0}
  .section-head button{display:inline-flex;align-items:center;gap:9px;border:1px solid var(--pt-line);background:var(--pt-surface);color:var(--pt-secondary);border-radius:12px;min-height:43px;padding:0 14px;font-size:12px;font-weight:740}
  .section-head button:hover{color:var(--pt-violet);box-shadow:var(--pt-shadow-small)}
  .apps-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
  .app-card{display:flex;align-items:center;gap:13px;padding:17px;background:var(--pt-surface);border:1px solid var(--pt-line);box-shadow:var(--pt-shadow-small);border-radius:20px;min-width:0}
  .app-icon{height:52px;width:52px;display:grid;place-items:center;flex:none;color:var(--pt-violet);background:var(--pt-violet-soft);border-radius:17px;font-weight:750;font-size:20px}
  .app-copy{display:grid;gap:5px;min-width:0;flex:1}.app-copy strong{font-size:14px;font-weight:740}.app-copy span{font-size:11px;color:var(--pt-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .launch{display:inline-flex;align-items:center;gap:7px;justify-content:center;flex:none;min-height:42px;padding:0 13px;background:var(--pt-violet-soft);color:var(--pt-violet);border-radius:12px;font-size:12px;font-weight:760}
  .launch:hover:not(:disabled){background:#6259ea;color:white}
  .empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:52px 22px;background:var(--pt-surface);border:1px solid var(--pt-line);border-radius:23px}
  .empty-icon{display:grid;place-items:center;height:75px;width:75px;border-radius:23px;background:var(--pt-violet-soft);color:var(--pt-violet);margin-bottom:20px}
  .empty strong{font-size:17px;font-weight:760}.empty p{max-width:480px;color:var(--pt-secondary);font-size:12px;line-height:1.75;margin:12px 0 15px}
  .empty button{min-height:43px;border:1px solid var(--pt-line);border-radius:12px;background:var(--pt-violet-soft);color:var(--pt-violet);padding:0 16px;font-size:12px;font-weight:750}
  .setup{display:grid;gap:11px;margin-top:15px;padding:21px;background:var(--pt-surface);border:1px solid var(--pt-line);border-radius:18px}
  .setup code{padding:13px;background:var(--pt-surface-soft);color:var(--pt-secondary);font-size:11px;border-radius:12px;overflow-wrap:anywhere;white-space:pre-wrap}
  .setup p{color:var(--pt-secondary);font-size:11px;line-height:1.6;margin:0}
  .receipt{display:flex;gap:10px;align-items:center;padding:16px;background:var(--pt-teal-soft);color:var(--pt-teal);border-radius:13px;margin-top:16px;font-size:12px;font-weight:700}
  .receipt.failed{background:#fff0ee;color:#bc5549}
  .future-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:27px}
  .future-grid>div{background:var(--pt-surface);border:1px solid var(--pt-line);box-shadow:var(--pt-shadow-small);border-radius:18px;padding:23px;display:flex;flex-direction:column;gap:7px}
  .feature-icon{display:grid;place-items:center;width:45px;height:45px;border-radius:15px;background:var(--pt-violet-soft);color:var(--pt-violet);margin-bottom:12px}
  .future-grid strong{font-size:13px;font-weight:740}.future-grid p{font-size:11px;color:var(--pt-secondary);line-height:1.7;margin:0;min-height:57px}
  .future-grid small{font-size:9px;letter-spacing:.6px;color:var(--pt-tertiary);font-weight:780;margin-top:auto}
  .hint{font-size:11px;color:var(--pt-secondary);line-height:1.7;margin-top:20px}
  @media(max-width:720px){
    .apps{padding:25px 18px 125px}.header h1{font-size:35px;margin:11px 0 9px}.header p{font-size:12px;margin-bottom:23px}
    .intro-card{padding:20px;gap:12px;min-height:110px;border-radius:18px}.intro-mark{height:49px;width:49px;border-radius:15px}.intro-card strong{font-size:13px}.intro-card p{font-size:11px}
    .section-head{margin:28px 0 15px}.section-head h2{font-size:20px}
    .apps-list{grid-template-columns:1fr;gap:10px}.app-card{padding:14px}.app-icon{height:45px;width:45px;border-radius:14px}
    .future-grid{grid-template-columns:1fr;gap:10px}.future-grid>div{padding:18px}.future-grid p{min-height:unset}
  }
</style>