<script lang="ts">
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
    <div class="intro-mark">⌘</div>
    <div><strong>{connected ? 'Your Mac is connected' : 'Your Mac is offline'}</strong>
      <p>{connected ? 'Only apps that were allowlisted locally on the Mac can be launched.' : 'Connect to your Mac before launching apps.'}</p></div>
    <span class="indicator" class:offline={!connected}></span>
  </div>

  <div class="section-head">
    <div><span>LOCALLY APPROVED</span><h2>Available applications</h2></div>
    <button onclick={() => fetchApprovedApps()} disabled={!connected}>↻ Refresh</button>
  </div>

  {#if $approvedApps.length}
    <div class="apps-list">
      {#each $approvedApps as app (app.bundleId)}
        <div class="app-card">
          <div class="app-icon">{app.name.slice(0, 1).toUpperCase()}</div>
          <div class="app-copy"><strong>{app.name}</strong><span>{app.bundleId}</span></div>
          <button class="launch" onclick={() => startApp(app.bundleId)} disabled={!connected || !!pendingId}>
            {pendingId && pendingBundle === app.bundleId ? 'Launching…' : 'Launch'} <span>↗</span>
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <div class="empty">
      <span class="empty-icon">◫</span><strong>No approved apps configured</strong>
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
    <div><div class="feature-icon">◈</div><strong>Existing windows</strong><p>List windows and switch between them through a native macOS integration.</p><small>NOT ENABLED</small></div>
    <div><div class="feature-icon">◉</div><strong>Browser tabs</strong><p>Use a permitted extension or existing browser automation API for supported tabs.</p><small>NOT ENABLED</small></div>
    <div><div class="feature-icon">⌖</div><strong>Screen interaction</strong><p>With explicit Screen Recording and Accessibility grants, control permitted UI elements.</p><small>NOT ENABLED</small></div>
  </div>
  <div class="hint">Launching an application does not grant access to passwords, private tabs, locked windows, or protected macOS controls.</div>
</section>

<style>
  .apps{flex:1;overflow-y:auto;padding:35px clamp(18px,4.5vw,70px) 55px;max-width:1320px;width:100%;margin:0 auto}
  .eyebrow,.section-head>div>span,.setup>span{font-size:10px;letter-spacing:1.65px;color:#789ca2;font-weight:850}.eyebrow span{color:#4a646b;margin:0 8px}
  .header h1{font-size:35px;letter-spacing:-1.4px;margin:11px 0 9px;font-weight:680}.header h1 span{color:#a2eacb}
  .header p{color:#95adb3;font-size:12px;max-width:620px;line-height:1.8;margin:0 0 28px}
  .intro-card{border:1px solid #36594f;background:linear-gradient(110deg,#183b36,#15232b);padding:23px 24px;border-radius:16px;display:flex;align-items:center;gap:15px}
  .intro-mark{font-size:26px;background:#25493f;color:#bafad9;border-radius:12px;height:52px;width:52px;display:grid;place-items:center}
  .intro-card strong{font-size:15px}.intro-card p{margin:6px 0 0;color:#9ab3b0;font-size:11px;line-height:1.6}
  .indicator{width:9px;height:9px;border-radius:50%;background:#9ef4c9;box-shadow:0 0 12px #8ff0c488;margin-left:auto;flex:none}.indicator.offline{background:#de9e89;box-shadow:none}
  .section-head{display:flex;justify-content:space-between;align-items:end;gap:12px;margin:29px 0 13px}
  .section-head h2{font-size:21px;margin:7px 0 0;font-weight:700;letter-spacing:-.6px}
  .section-head button{background:#1b3630;border:1px solid #3b594f;border-radius:9px;padding:10px 12px;color:#b3f3d5;font-size:11px}
  .apps-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
  .app-card{display:flex;gap:11px;align-items:center;min-width:0;padding:16px;background:#16262f;border:1px solid #2a4244;border-radius:13px}
  .app-icon{flex:none;width:40px;height:40px;border-radius:11px;background:#254739;color:#adeccb;font-weight:850;font-size:18px;display:grid;place-items:center}
  .app-copy{flex:1;min-width:0;display:grid;gap:4px}.app-copy strong{font-size:13px}.app-copy span{font-size:10px;color:#809ca2;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
  .launch{background:#aaf9d5;color:#164335;border:0;border-radius:9px;padding:11px 13px;font-weight:850;font-size:11px;white-space:nowrap}.launch span{margin-left:6px}
  .launch:disabled{opacity:.5}.empty{text-align:center;padding:42px 22px;border:1px dashed #35514c;background:#111f29;border-radius:14px}
  .empty-icon{font-size:36px;color:#9cdebf;display:block;margin-bottom:13px}.empty strong{font-size:16px}.empty p{font-size:12px;color:#95adb1;max-width:430px;margin:10px auto;line-height:1.8}
  .empty button{border:0;background:none;color:#a9f3d4;padding:9px;font-size:12px;font-weight:800}
  .setup{background:#182c33;border:1px solid #36574f;border-radius:12px;margin-top:12px;padding:18px;display:grid;gap:12px}
  .setup code{white-space:pre-wrap;overflow-wrap:anywhere;color:#c1efda;font-size:11px;background:#0f1c25;padding:12px;border-radius:9px}
  .setup p{color:#93afb1;font-size:11px;line-height:1.7;margin:0}
  .receipt{border:1px solid #3c6c53;color:#b4efd0;background:#1b342b;border-radius:10px;padding:14px;margin-top:16px;font-size:12px}
  .receipt.failed{border-color:#834a51;background:#392529;color:#f5c1c6}.receipt span{margin-right:9px}
  .future-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:27px}
  .future-grid>div{border:1px solid #2f4449;background:#15242e;border-radius:13px;padding:22px}
  .feature-icon{color:#97e5c6;font-size:26px;margin-bottom:16px}.future-grid strong{display:block;font-size:13px}
  .future-grid p{font-size:11px;color:#88a2aa;line-height:1.7;min-height:51px}
  .future-grid small{font-size:8px;letter-spacing:1px;color:#8fb3ae;font-weight:800}
  .hint{margin-top:22px;color:#91a8a9;font-size:11px;line-height:1.7}
  @media(max-width:760px){.apps{padding:24px 17px 35px}.header h1{font-size:31px}.intro-card{padding:18px;gap:11px}
    .intro-mark{width:42px;height:42px}.intro-card strong{font-size:13px}.apps-list{grid-template-columns:1fr}.future-grid{grid-template-columns:1fr;gap:8px}
    .future-grid>div{padding:17px}.future-grid p{min-height:unset}.future-grid .feature-icon{margin-bottom:9px}
  }

  .apps{color:#2c2b45}
  .eyebrow{color:#8b7fb9}.header h1{color:#29263d}.header h1 span{color:#836ce1}.header p{color:#9697a8}
  .intro-card{background:linear-gradient(120deg,#f6f2ff,#f0efff);border-color:#e6e0fa;border-radius:21px}
  .intro-mark{background:#e5ddff;color:#8568d9}
  .intro-card strong{color:#333249}.intro-card p{color:#8d8ba6}.indicator{background:#4fc8a3;box-shadow:0 0 0 4px #e5f8ef}
  .section-head>div>span{color:#a19bb7}.section-head h2{color:#29283d}
  .section-head button{color:#7961da;background:#efebff;border-color:#dfd9f7;min-height:44px}
  .app-card{background:#fff;border-color:#eae9f4;border-radius:18px;box-shadow:0 6px 18px #34355909}
  .app-icon{background:#efebff;color:#8065dc}.app-copy strong{color:#34314c}.app-copy span{color:#9a96b0}
  .launch{background:#7b63e4;color:#fff;min-height:44px}.launch:hover:not(:disabled){background:#6853d0;transform:translateY(-1px)}
  .empty{background:#fff;border-color:#dedbef;border-radius:19px}.empty-icon{color:#8e74df}
  .empty strong{color:#383349}.empty p{color:#8f8ca2}.empty button{color:#7862d9;min-height:44px}
  .setup{background:#f5f2ff;border-color:#e2dbf8}
  .setup>span{color:#8f7bad}.setup code{background:#fff;color:#6454ab}.setup p{color:#9792ab}
  .receipt{color:#2a977d;border-color:#d8f2e7;background:#edfaf4}
  .receipt.failed{background:#fff0f2;border-color:#efd1d7;color:#bb6c79}
  .future-grid>div{background:#fff;border-color:#ebe9f4;border-radius:18px}
  .feature-icon{color:#8b71dd}.future-grid strong{color:#343047}.future-grid p{color:#9998ab}
  .future-grid small{color:#9a8fbd}.hint{color:#9695a8}
  @media(hover:none){.launch:hover:not(:disabled){transform:none}}

</style>
