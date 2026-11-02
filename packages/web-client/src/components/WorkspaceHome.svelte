<script lang="ts">
  import Icon from './Icon.svelte';
  import { sessions, status, current } from '../lib/store';
  import type { SessionInfo } from '../lib/types';

  let { onOpenSession, onNewSession, onAllSessions, onFiles, onApps, onMachine }: {
    onOpenSession: (id: string) => void; onNewSession: () => void; onAllSessions: () => void;
    onFiles: () => void; onApps: () => void; onMachine: () => void;
  } = $props();

  const online = $derived($status === 'open');
  const active = $derived($sessions.filter(s => !s.detached));
  const pending = $derived($sessions.reduce((n,s) => n + s.pendingApprovals, 0));
  const selected = $derived($sessions.find(s => s.sessionId === $current) ?? active[0] ?? $sessions[0] ?? null);
  const projects = $derived(new Set($sessions.map(s => s.cwd)).size);
  let query = $state('');
  const visible = $derived($sessions.filter(s =>
    !query || (nameOf(s)+' '+s.cwd+' '+(s.vendor ?? '')).toLowerCase().includes(query.toLowerCase())
  ).slice(0,6));

  function nameOf(s: SessionInfo): string { return s.cwd.split('/').filter(Boolean).pop() || 'Home shell'; }
  function typeOf(s: SessionInfo): string {
    return s.vendor === 'claude' ? 'Claude Code' : s.vendor === 'codex' ? 'Codex' : s.vendor || 'Real shell';
  }
  function age(ts: number): string {
    const sec = Math.max(0, Math.floor((Date.now()-ts)/1000));
    return sec < 60 ? 'Just now' : sec < 3600 ? Math.floor(sec/60)+'m ago' : Math.floor(sec/3600)+'h ago';
  }
</script>

<section class="home" aria-label="Pocket-T workbench">
  <header class="introduction">
    <div>
      <span class="eyebrow"><i></i> YOUR WORKSPACE, ANYWHERE</span>
      <h1>Everything in<br/><em>your orbit.</em></h1>
      <p>Your Mac, your work, every live session. Beautifully connected.</p>
    </div>
    <button class="device" onclick={onMachine}>
      <span class="device-glyph"><Icon name="monitor" size={19}/></span>
      <span><strong>My Mac</strong><small>{online ? 'Connected & ready' : 'Waiting to connect'}</small></span>
      <i class:offline={!online}></i>
      <Icon name="chevron" size={16}/>
    </button>
  </header>

  <div class="hero">
    <div class="glow glow-a"></div><div class="glow glow-b"></div>
    <div class="hero-content">
      <span class="hero-kicker"><Icon name="activity" size={16}/> YOUR LIVE WORKSPACE</span>
      <h2>Your work.<br/><em>Still moving.</em></h2>
      <p>{online ? 'Continue the exact session on your Mac. No duplicate shell. No AI tokens needed.' : 'Your workspace will be right here as soon as your Mac reconnects.'}</p>
      <button class="resume" onclick={() => selected ? onOpenSession(selected.sessionId) : onNewSession()} disabled={!online}>
        <span><Icon name={selected ? 'play' : 'plus'} size={18}/></span>
        {selected ? 'Continue working' : 'Start a session'}
        <Icon name="arrow" size={17}/>
      </button>
    </div>
    <div class="orbital" aria-hidden="true">
      <div class="ring ring1"></div><div class="ring ring2"></div><div class="ring ring3"></div>
      <div class="orb"><div></div></div>
      <span class="floating-chip chip-one"><Icon name="check" size={14}/> Always in sync</span>
      <span class="floating-chip chip-two"><i></i> {online ? 'Connected' : 'Offline'}</span>
      <span class="tiny-star star-one">✦</span><span class="tiny-star star-two">✦</span>
    </div>
    <div class="hero-footer"><span>POCKET-T / 01</span><span></span><span>EVERYWHERE, TOGETHER</span></div>
  </div>

  <div class="metrics">
    <button onclick={onAllSessions}><span class="metric-icon lilac"><Icon name="layers" size={21}/></span><strong>{String(active.length).padStart(2,'0')}</strong><span>Live sessions<small>Ready to join</small></span></button>
    <button onclick={onAllSessions}><span class="metric-icon ice"><Icon name="folder" size={21}/></span><strong>{String(projects).padStart(2,'0')}</strong><span>Workspaces<small>On your Mac</small></span></button>
    <button onclick={onAllSessions}><span class="metric-icon peach"><Icon name="activity" size={21}/></span><strong>{String(pending).padStart(2,'0')}</strong><span>Attention<small>{pending ? 'Review needed' : 'All clear'}</small></span></button>
  </div>

  <div class="section-heading">
    <div><span class="eyebrow subtle">PICK UP WHERE YOU LEFT OFF</span><h2>Your sessions <sup>{$sessions.length}</sup></h2></div>
    <button onclick={onAllSessions}>View all <Icon name="arrow" size={17}/></button>
  </div>

  {#if $sessions.length > 3}
    <label class="filter"><Icon name="search" size={18}/><input type="search" aria-label="Filter sessions" placeholder="Find a session or project" bind:value={query}/></label>
  {/if}

  <div class="session-list">
    {#each visible as s,i (s.sessionId)}
      <button class="session" onclick={() => onOpenSession(s.sessionId)} style:--delay={i * 45 + 'ms'}>
        <span class="session-glyph" class:agent={!!s.vendor}><Icon name={s.vendor ? 'sparkle' : 'terminal'} size={23}/></span>
        <span class="session-copy"><strong>{nameOf(s)}</strong><small>{typeOf(s)} <b>·</b> {age(s.lastActiveAt)}</small></span>
        <span class:inactive={s.detached} class="session-state"><i></i>{s.detached ? 'Detached' : 'Live'}</span>
        <span class="session-go"><Icon name="arrow" size={17}/></span>
      </button>
    {/each}
    {#if !$sessions.length}
      <div class="empty">
        <span><Icon name="layers" size={29}/></span>
        <strong>A fresh workspace, ready for you.</strong>
        <p>Create a real terminal on your Mac. Nothing is simulated and no AI is required.</p>
        <button onclick={onNewSession} disabled={!online}>Create a session <Icon name="arrow" size={15}/></button>
      </div>
    {:else if !visible.length}
      <div class="empty">No sessions match your search.</div>
    {/if}
  </div>

  <div class="section-heading quick-title"><div><span class="eyebrow subtle">THE REST OF YOUR MACHINE</span><h2>Explore your Mac</h2></div></div>
  <div class="quick-grid">
    <button onclick={onFiles}><span class="quick-icon lilac"><Icon name="folder" size={21}/></span><span><strong>Files & folders</strong><small>Explore your workspace</small></span><Icon name="arrow" size={17}/></button>
    <button onclick={onApps}><span class="quick-icon aqua"><Icon name="apps" size={21}/></span><span><strong>Applications</strong><small>Open supported apps</small></span><Icon name="arrow" size={17}/></button>
    <button onclick={onAllSessions}><span class="quick-icon peach"><Icon name="terminal" size={21}/></span><span><strong>Live terminals</strong><small>Jump into your shell</small></span><Icon name="arrow" size={17}/></button>
  </div>
  <div class="foot"><Icon name="lock" size={13}/> Real controls. No AI subscription or tokens required.</div>
</section>

<style>
  .home{--ink:#22223b;--soft:#898b9d;flex:1;overflow-y:auto;min-width:0;width:100%;max-width:1490px;margin:0 auto;padding:31px clamp(22px,5vw,82px) 55px;color:var(--ink);scrollbar-width:thin;scrollbar-color:#d7d7e7 transparent}
  button{font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}
  .introduction{display:flex;justify-content:space-between;gap:25px;align-items:start;margin-bottom:28px}
  .eyebrow{display:inline-flex;align-items:center;gap:10px;color:#8171c2;font-size:10px;font-weight:820;letter-spacing:1.6px}.eyebrow i{background:#8676f5;height:2px;width:17px}
  .introduction h1{font-size:clamp(39px,4.4vw,62px);font-weight:780;letter-spacing:-3.1px;line-height:1.06;margin:15px 0}.introduction h1 em{font-style:normal;color:#7761d8}
  .introduction p{font-size:14px;color:var(--soft);line-height:1.7;margin:0}
  .device{display:flex;align-items:center;gap:11px;background:#fff;border:1px solid #e8e8f2;border-radius:17px;padding:11px;box-shadow:0 8px 25px #2728440a;text-align:left;transition:transform .26s,box-shadow .26s}
  .device:hover{transform:translateY(-3px);box-shadow:0 15px 30px #22234216}
  .device-glyph{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:#efedff;color:#7b6ae1}
  .device>span:nth-child(2){display:grid;gap:4px;min-width:95px}.device strong{font-size:12px;color:#30314d}.device small{font-size:10px;color:#9496a7}
  .device>i{background:#55c7a4;width:8px;height:8px;border-radius:50%;box-shadow:0 0 0 4px #e5f9f0}.device>i.offline{background:#cc9da4;box-shadow:0 0 0 4px #f9e8eb}
  .device > :global(svg){color:#a0a0b5}
  .hero{position:relative;isolation:isolate;overflow:hidden;border-radius:28px;min-height:331px;padding:38px 42px;color:#fff;background:linear-gradient(113deg,#242646 0%,#22244c 45%,#5045ac 100%);box-shadow:0 25px 55px #30308f27}
  .hero:after{content:'';position:absolute;inset:1px;border:1px solid #ffffff33;border-radius:27px;pointer-events:none;z-index:5}
  .glow{position:absolute;pointer-events:none;filter:blur(55px);border-radius:50%}.glow-a{width:430px;height:290px;right:-50px;top:-50px;background:#a28df49c}.glow-b{width:360px;height:250px;right:250px;bottom:-175px;background:#695edb6c}
  .hero-content{position:relative;z-index:4;max-width:405px}.hero-kicker{display:flex;align-items:center;gap:10px;font-weight:800;font-size:10px;letter-spacing:1.6px;color:#dad8fa}
  .hero h2{font-size:clamp(36px,3.4vw,53px);font-weight:760;line-height:1.07;letter-spacing:-2.7px;margin:22px 0 14px}
  .hero h2 em{font-style:normal;background:linear-gradient(90deg,#c2eefd,#e8c9f7);color:transparent;background-clip:text}
  .hero p{font-size:12px;color:#d1d1ec;line-height:1.9;max-width:330px;margin:0}
  .resume{display:flex;align-items:center;gap:12px;margin-top:23px;border:0;background:#fff;border-radius:13px;min-height:48px;padding:7px 15px 7px 8px;color:#27233e;font-size:12px;font-weight:780;box-shadow:0 11px 26px #090b281a;transition:transform .25s cubic-bezier(.22,1,.36,1),box-shadow .25s}
  .resume:hover:not(:disabled){transform:translateY(-3px);box-shadow:0 16px 30px #0004}.resume:active:not(:disabled){transform:scale(.97)}
  .resume>span{width:34px;height:34px;border-radius:10px;background:#eae7ff;color:#7865e4;display:grid;place-items:center}.resume > :global(svg:last-child){margin-left:15px;color:#8179a4}
  .orbital{position:absolute;top:0;right:37px;width:405px;height:337px;pointer-events:none}
  .ring{position:absolute;border:1px solid #ffffff4a;border-radius:50%;top:50%;left:53%;transform:translate(-50%,-50%)}
  .ring1{width:195px;height:195px}.ring2{width:278px;height:278px;border-color:#ffffff36}.ring3{width:349px;height:349px;border-style:dashed;border-color:#ffffff2b}
  .orb{position:absolute;left:115px;top:65px;width:210px;height:210px;border-radius:50%;background:radial-gradient(circle at 30% 25%,#fff 0%,#d4d2ff 24%,#9d9ef1 47%,#6b66b7 78%,#5d539f 100%);box-shadow:inset 9px 12px 23px #ffffffb8,inset -30px -25px 45px #211e756c,0 16px 53px #b6b7ff75;animation:orbFloat 8s ease-in-out infinite}
  .orb>div{position:absolute;left:16px;top:50px;width:170px;height:95px;transform:rotate(-32deg);border:2px solid #ffffff75;border-radius:50%}
  .floating-chip{position:absolute;z-index:2;display:flex;align-items:center;gap:7px;background:#fffe;backdrop-filter:blur(18px);border:1px solid #fff;color:#454267;border-radius:12px;padding:10px 12px;box-shadow:0 13px 30px #21195140;font-size:10px;font-weight:750;white-space:nowrap}
  .chip-one{top:74px;left:2px;transform:rotate(-5deg)}.chip-one :global(svg){color:#23ad8d}.chip-two{bottom:44px;right:0;transform:rotate(5deg)}
  .chip-two i{height:8px;width:8px;border-radius:50%;background:#57c9a5}
  .tiny-star{position:absolute;color:#e4d9ff}.star-one{bottom:46px;left:75px}.star-two{top:35px;right:40px;font-size:25px}
  .hero-footer{position:absolute;z-index:3;bottom:18px;left:42px;right:42px;display:flex;align-items:center;gap:13px;color:#c5c7dfaa;font-size:8px;letter-spacing:1.7px;font-weight:750}
  .hero-footer span:nth-child(2){height:1px;flex:1;background:#ffffff42}
  .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;margin-top:17px}
  .metrics button{display:flex;gap:12px;align-items:center;background:#fff;border:1px solid #ebebf5;border-radius:19px;padding:18px;text-align:left;min-width:0;box-shadow:0 5px 20px #34366709;transition:transform .24s cubic-bezier(.22,1,.36,1),box-shadow .24s}
  .metrics button:hover{transform:translateY(-3px);box-shadow:0 14px 25px #4c4b8e1a}
  .metric-icon{width:44px;height:44px;flex:none;display:grid;place-items:center;border-radius:14px}.lilac{background:#efecff;color:#7764df}.ice{background:#e9f0ff;color:#628cf0}.peach{background:#fff0e9;color:#d69a78}.aqua{background:#e3f8f4;color:#40b0a0}
  .metrics strong{font-size:27px;letter-spacing:-1.2px;font-variant-numeric:tabular-nums;color:#28293d}
  .metrics button>span:last-child{font-size:11px;font-weight:750;color:#43445f;display:grid;gap:5px;white-space:nowrap}
  .metrics small{font-size:10px;color:#9a9caf;font-weight:450}
  .section-heading{display:flex;align-items:end;justify-content:space-between;gap:15px;margin:36px 0 15px}.section-heading .subtle{color:#9895aa;font-size:9px}
  .section-heading h2{font-size:23px;letter-spacing:-.8px;margin:8px 0 0}.section-heading h2 sup{font-size:12px;color:#a9a6b7;vertical-align:super}
  .section-heading>button{min-height:44px;display:flex;align-items:center;gap:7px;border:0;background:none;color:#7d65db;font-size:12px;font-weight:800}
  .filter{display:flex;align-items:center;gap:10px;padding:13px 14px;background:white;color:#9188b3;border:1px solid #ebe9f4;border-radius:13px;margin-bottom:9px}
  .filter input{flex:1;outline:none;border:0;font:inherit;font-size:14px;min-width:0}
  .session-list{border-radius:20px;border:1px solid #ecebf4;background:#fff;overflow:hidden;box-shadow:0 7px 22px #34396008}
  .session{width:100%;min-height:74px;display:flex;align-items:center;gap:13px;padding:12px 16px;text-align:left;border:0;border-bottom:1px solid #f0eff5;background:#fff;animation:rise .36s cubic-bezier(.22,1,.36,1) both;animation-delay:var(--delay);transition:background .18s,transform .2s}
  .session:last-child{border-bottom:0}.session:hover{background:#faf8ff}.session:active{transform:scale(.993)}
  .session-glyph{width:45px;height:45px;flex:none;display:grid;place-items:center;border-radius:14px;background:#eff1ff;color:#6676d3}.session-glyph.agent{background:#f0eaff;color:#9869cf}
  .session-copy{flex:1;min-width:0;display:grid;gap:5px}.session-copy strong{color:#303047;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.session-copy small{font-size:11px;color:#989aae;white-space:nowrap}
  .session-copy b{padding:0 4px}.session-state{color:#249f80;display:flex;align-items:center;gap:7px;font-size:10px;font-weight:720}.session-state i{width:7px;height:7px;background:#4cc8a4;border-radius:50%}.session-state.inactive{color:#c59d9b}.session-state.inactive i{background:#c59d9b}
  .session-go{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:#f1efff;color:#806cdb;transition:transform .2s}.session:hover .session-go{transform:translate(2px,-2px)}
  .empty{display:flex;flex-direction:column;align-items:center;padding:37px 20px;text-align:center;color:#737486;font-size:12px}
  .empty>span{width:60px;height:60px;display:grid;place-items:center;background:#f0edff;color:#7a65d7;border-radius:18px;margin-bottom:14px}.empty strong{font-size:16px;color:#2c2e4b}.empty p{font-size:12px;line-height:1.7;max-width:280px}
  .empty button{display:flex;align-items:center;gap:7px;min-height:44px;border:0;background:#7565dc;color:#fff;border-radius:11px;padding:0 15px;font-size:12px;font-weight:700}
  .quick-title{margin-top:33px}.quick-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:13px}
  .quick-grid button{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #ebeaf3;border-radius:18px;padding:15px;text-align:left;min-width:0;transition:transform .25s cubic-bezier(.22,1,.36,1),box-shadow .25s}
  .quick-grid button:hover{transform:translateY(-3px);box-shadow:0 14px 28px #47476e14}
  .quick-icon{width:44px;height:44px;display:grid;place-items:center;flex:none;border-radius:14px}
  .quick-grid button>span:nth-child(2){flex:1;min-width:0;display:grid;gap:5px}.quick-grid strong{font-size:12px;color:#3d3d59;white-space:nowrap}.quick-grid small{font-size:10px;color:#9699ab;white-space:nowrap}.quick-grid button > :global(svg:last-child){color:#aaa6bb}
  .foot{display:flex;align-items:center;justify-content:center;gap:7px;padding:26px;color:#9d9faf;font-size:10px}
  @keyframes orbFloat{50%{transform:translateY(-9px)}}@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @media(max-width:1100px){.orbital{right:-35px}.metrics button{padding:14px 10px;gap:8px}.metrics small{display:none}}
  @media(max-width:800px){
    .home{padding:23px 19px 125px}.introduction{margin-bottom:20px}.introduction h1{font-size:41px;letter-spacing:-2.4px;margin:13px 0}
    .introduction p{font-size:12px;max-width:290px}.device{display:none}
    .hero{border-radius:23px;min-height:308px;padding:28px 23px}.hero:after{border-radius:22px}
    .hero h2{font-size:34px;letter-spacing:-1.6px;margin:18px 0 12px}.hero p{font-size:11px;max-width:220px;line-height:1.8}
    .hero-content{max-width:258px}.hero-kicker{font-size:8px}.resume{min-height:46px;font-size:11px;margin-top:19px;padding-right:11px}.resume>span{width:31px;height:31px}
    .resume > :global(svg:last-child){margin-left:0}.orbital{width:255px;height:289px;right:-94px;top:7px;opacity:.72}
    .ring1{width:135px;height:135px}.ring2{width:205px;height:205px}.ring3{width:269px;height:269px}
    .orb{left:79px;top:85px;width:130px;height:130px}.orb>div{left:9px;top:34px;width:112px;height:69px}
    .floating-chip{font-size:8px;padding:7px;border-radius:8px}.chip-one{top:81px;left:0}.chip-two{bottom:55px;right:0}
    .star-one{bottom:28px;left:25px}.star-two{top:40px;right:30px}.hero-footer{bottom:17px;left:23px;right:23px;font-size:7px;letter-spacing:.9px}
    .metrics{gap:8px;margin-top:12px}.metrics button{flex-direction:column;align-items:flex-start;gap:4px;min-height:113px;border-radius:15px;padding:12px}
    .metric-icon{width:31px;height:31px;border-radius:10px}.metric-icon :global(svg){width:17px;height:17px}
    .metrics strong{font-size:21px}.metrics button>span:last-child{font-size:9px;letter-spacing:-.15px}
    .section-heading{margin:29px 0 12px}.section-heading h2{font-size:21px;margin-top:7px}
    .session{gap:11px;min-height:70px;padding:11px 12px}.session-glyph{height:40px;width:40px;border-radius:12px}
    .session-copy strong{font-size:13px}.session-copy small{font-size:10px}.session-state{font-size:9px}.session-go{height:31px;width:31px}
    .quick-title{margin-top:29px}.quick-grid{grid-template-columns:1fr;gap:9px}.quick-grid button{min-height:72px;padding:12px 14px}.foot{padding:23px 5px}
  }
  @media(max-width:370px){.home{padding:20px 14px 115px}.introduction h1{font-size:37px}.hero{padding:25px 18px}.hero h2{font-size:31px}.orbital{opacity:.52}.metrics button{padding:9px}.metrics button>span:last-child{font-size:8px}}
  @media(hover:none){.device:hover,.metrics button:hover,.quick-grid button:hover,.resume:hover{transform:none}.session:hover{background:#fff}}
  @media(prefers-reduced-motion:reduce){.orb,.session{animation:none}.resume,.device,.metrics button,.session,.session-go,.quick-grid button{transition:none}}
</style>