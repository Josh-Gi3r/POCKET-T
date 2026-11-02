<script lang="ts">
  import PTIcon from './PTIcon.svelte';
  import { sessions, status, spawnSession, spawnState } from '../lib/store';
  import type { SessionInfo } from '../lib/types';

  type Route = 'home' | 'terminal' | 'files' | 'apps' | 'machine';
  let { onNavigate, onOpenSession }: {
    onNavigate: (target: Route) => void;
    onOpenSession: (sessionId: string) => void;
  } = $props();

  const online = $derived($status === 'open');
  const active = $derived($sessions.filter((s) => !s.detached));
  const sorted = $derived([...$sessions].sort((a, b) => b.lastActiveAt - a.lastActiveAt));
  const recent = $derived(sorted[0] ?? null);
  const attention = $derived($sessions.reduce((count, s) => count + s.pendingApprovals, 0));

  function label(s: SessionInfo): string {
    return s.cwd.split('/').filter(Boolean).pop() ?? 'Mac terminal';
  }
  function kind(s: SessionInfo): string {
    if (s.sessionId.startsWith('join-')) return 'Joined session';
    if (s.vendor === 'claude') return 'Claude Code';
    if (s.vendor === 'codex') return 'Codex';
    return s.vendor || 'Shell';
  }
  function when(ts: number): string {
    const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return minutes + 'm ago';
    if (minutes < 1440) return Math.floor(minutes / 60) + 'h ago';
    return Math.floor(minutes / 1440) + 'd ago';
  }
  function newShell() {
    if (!online || $spawnState.status === 'starting') return;
    spawnSession();
    onNavigate('terminal');
  }
</script>

<div class="home-layout">
  <header class="welcome">
    <div class="topline">
      <div class="pt-eyebrow">YOUR SPACE <span class="dot-separator">·</span> POCKET-T</div>
      <div class="machine-pill"><span class="pt-status-dot" data-state={online ? 'online' : 'offline'}></span>{online ? 'Your Mac is connected' : 'Mac is offline'}</div>
    </div>
    <div class="welcome-headline">
      <div>
        <h1>Everything, <em>within reach.</em></h1>
        <p>The work on your computer, beautifully connected to wherever you are.</p>
      </div>
      {#if attention > 0}<div class="attention-pill"><PTIcon name="sparkles" size={15}/>{attention} approval{attention === 1 ? '' : 's'} need attention</div>{/if}
    </div>
  </header>

  <section class="hero-card pt-card-enter">
    <div class="hero-copy">
      <div class="hero-overline"><span class="small-sun"></span> PICK UP WHERE YOU LEFT OFF</div>
      <h2>{recent ? label(recent) : 'Your Mac, anywhere.'}</h2>
      <p>{recent ? 'Your session is exactly where you left it. Jump back in, without starting over.' : 'Open a real shell, explore files and manage your machine—all in one place.'}</p>
      <div class="hero-actions">
        <button class="hero-cta" onclick={() => recent ? onOpenSession(recent.sessionId) : newShell()} disabled={!online}>
          {recent ? 'Continue session' : 'Start a session'} <PTIcon name="arrowUpRight" size={17}/>
        </button>
        <button class="hero-secondary" onclick={() => onNavigate('terminal')}>View workspace <PTIcon name="arrowRight" size={16}/></button>
      </div>
      <div class="hero-foot"><span class="pt-status-dot" data-state={online ? 'online' : 'offline'}></span>{recent ? kind(recent) + ' · ' + when(recent.lastActiveAt) : online ? 'Ready to connect' : 'Reconnect your Mac to begin'}</div>
    </div>
    <div class="hero-art" aria-hidden="true">
      <div class="hero-glow"></div>
      <div class="orbit orbit-one"></div><div class="orbit orbit-two"></div>
      <div class="float-card back-card"><span class="card-microline"></span><span class="card-microline short"></span><span class="card-microline"></span></div>
      <div class="float-card front-card">
        <div class="float-header"><span class="float-avatar"><PTIcon name="layers" size={20}/></span><span class="float-tiny"></span></div>
        <div class="float-stack"><i></i><i></i><i></i></div>
        <div class="float-bottom"><span></span><span></span></div>
      </div>
      <div class="glow-spark star-a"></div><div class="glow-spark star-b"></div>
    </div>
  </section>

  <section class="workspace-section">
    <div class="section-heading">
      <div><span class="pt-eyebrow">ONE SPACE, EVERY CAPABILITY</span><h2>Your workspace</h2></div>
      <span class="mini-caption">Move effortlessly between what matters</span>
    </div>
    <div class="tool-grid">
      <button class="tool-card pt-hover-lift" onclick={() => onNavigate('terminal')}>
        <span class="tool-icon tool-purple"><PTIcon name="terminal" size={21}/></span>
        <span class="tool-text"><strong>Terminals</strong><small>Join your live sessions</small></span>
        <span class="tool-arrow"><PTIcon name="arrowUpRight" size={16}/></span>
      </button>
      <button class="tool-card pt-hover-lift" onclick={() => onNavigate('files')}>
        <span class="tool-icon tool-blue"><PTIcon name="folder" size={21}/></span>
        <span class="tool-text"><strong>Files</strong><small>Everything, organised</small></span>
        <span class="tool-arrow"><PTIcon name="arrowUpRight" size={16}/></span>
      </button>
      <button class="tool-card pt-hover-lift" onclick={() => onNavigate('apps')}>
        <span class="tool-icon tool-coral"><PTIcon name="apps" size={21}/></span>
        <span class="tool-text"><strong>Applications</strong><small>Open what you need</small></span>
        <span class="tool-arrow"><PTIcon name="arrowUpRight" size={16}/></span>
      </button>
      <button class="tool-card pt-hover-lift" onclick={() => onNavigate('machine')}>
        <span class="tool-icon tool-teal"><PTIcon name="laptop" size={21}/></span>
        <span class="tool-text"><strong>My machine</strong><small>One connected computer</small></span>
        <span class="tool-arrow"><PTIcon name="arrowUpRight" size={16}/></span>
      </button>
    </div>
  </section>

  <section class="session-section">
    <div class="section-heading">
      <div><span class="pt-eyebrow">STAY IN FLOW</span><h2>Recent sessions</h2></div>
      <button class="all-sessions" onclick={() => onNavigate('terminal')}>All sessions <PTIcon name="arrowRight" size={16}/></button>
    </div>
    <div class="session-rows">
      {#each sorted.slice(0, 4) as s (s.sessionId)}
        <button class="session-row" onclick={() => onOpenSession(s.sessionId)}>
          <span class="session-symbol"><PTIcon name={s.vendor ? 'sparkles' : 'terminal'} size={19}/></span>
          <span class="session-details"><strong>{label(s)}</strong><small>{kind(s)} <span class="separator">·</span> {when(s.lastActiveAt)}</small></span>
          <span class="session-status" class:dimmed={s.detached}>{s.detached ? 'Detached' : 'Active'}</span>
          <span class="session-open"><PTIcon name="arrowUpRight" size={18}/></span>
        </button>
      {/each}
      {#if sorted.length === 0}
        <div class="empty-sessions">
          <span class="empty-icon"><PTIcon name="layers" size={23}/></span>
          <div><strong>No sessions yet</strong><p>Start a shell to see your live work here.</p></div>
          <button onclick={newShell} disabled={!online}>New session <PTIcon name="plus" size={16}/></button>
        </div>
      {/if}
    </div>
  </section>
</div>

<style>
  .home-layout { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; max-width:1260px; width:100%; margin:0 auto; padding:40px clamp(25px,4.7vw,76px) 100px; scrollbar-width:thin; scrollbar-color:var(--pt-line-strong) transparent; }
  .welcome { margin-bottom:27px; }
  .topline { display:flex; align-items:center; justify-content:space-between; gap:10px; }
  .dot-separator { margin:0 7px; opacity:.5; }
  .machine-pill { font-size:11px; font-weight:680; color:var(--pt-secondary); display:flex; align-items:center; gap:10px; background:var(--pt-glass); border:1px solid var(--pt-line); border-radius:999px; padding:10px 14px; }
  .welcome-headline { display:flex; align-items:end; gap:12px; justify-content:space-between; margin-top:24px; }
  h1,h2,p { margin:0; }
  h1 { font-size:clamp(38px,4.7vw,65px); letter-spacing:-.065em; line-height:1.09; font-weight:735; }
  h1 em { font-style:normal; font-weight:540; color:var(--pt-violet); }
  .welcome-headline p { color:var(--pt-secondary); line-height:1.65; font-size:14px; margin-top:13px; }
  .attention-pill { display:flex; align-items:center; gap:9px; padding:10px 14px; background:var(--pt-violet-soft); color:var(--pt-violet); border-radius:999px; font-size:11px; font-weight:720; white-space:nowrap; }
  .hero-card { isolation:isolate; min-height:325px; position:relative; overflow:hidden; display:flex; background:linear-gradient(113deg,#262646 0%,#3a3a77 43%,#6261ac 100%); color:#fff; border-radius:29px; padding:45px clamp(28px,4.3vw,64px); box-shadow:0 24px 66px rgba(65,62,125,.21); }
  .hero-card:before { content:''; position:absolute; inset:0; pointer-events:none; background:radial-gradient(ellipse at 92% 30%,rgba(180,181,255,.32),transparent 49%),radial-gradient(ellipse at 64% 130%,rgba(123,231,218,.12),transparent 55%); }
  .hero-copy { position:relative; z-index:2; width:65%; }
  .hero-overline { display:flex; align-items:center; gap:9px; font-size:10px; letter-spacing:1.7px; font-weight:790; color:#d1d1fc; }
  .small-sun { display:inline-block; height:6px; width:6px; border-radius:50%; background:#d8c6ff; box-shadow:0 0 0 5px #ffffff16; }
  .hero-copy h2 { margin-top:29px; font-size:clamp(31px,3.2vw,45px); line-height:1.11; letter-spacing:-1.6px; font-weight:710; }
  .hero-copy p { font-size:13px; line-height:1.8; color:#e0def9; max-width:360px; margin:13px 0 23px; }
  .hero-actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
  .hero-cta { background:#fff; color:#39317e; padding:0 18px; min-height:46px; font-size:12px; border-radius:14px; font-weight:760; display:flex; align-items:center; gap:13px; box-shadow:0 12px 24px #17164c33; }
  .hero-cta:hover:not(:disabled) { background:#f3f1ff; transform:translateY(-2px); box-shadow:0 17px 33px #17164c44; }
  .hero-secondary { background:#ffffff15; color:white; border:1px solid #ffffff38; padding:0 15px; min-height:46px; font-size:12px; font-weight:660; border-radius:14px; display:flex; align-items:center; gap:9px; }
  .hero-secondary:hover { background:#ffffff26; }
  .hero-foot { margin-top:24px; display:flex; align-items:center; gap:11px; font-size:11px; font-weight:580; color:#d2cff9; }
  .hero-foot :global(.pt-status-dot) { background:#a3ffdc; box-shadow:0 0 0 4px #c1ffe425; }
  .hero-art { pointer-events:none; position:absolute; right:3%; width:38%; top:0; bottom:0; }
  .hero-glow { position:absolute; right:4%; top:12%; width:340px; max-width:100%; aspect-ratio:1; border-radius:50%; background:radial-gradient(circle,rgba(222,218,255,.25),rgba(202,192,255,.03) 63%,transparent 70%); }
  .orbit { position:absolute; border:1px solid #ffffff32; border-radius:50%; right:6%; top:4%; width:315px; aspect-ratio:1; transform:rotate(-23deg); }
  .orbit-two { width:245px; right:14%; top:16%; border-style:dashed; opacity:.65; animation:orbit-rotate 60s linear infinite; }
  .float-card { position:absolute; border:1px solid #ffffff78; background:#fbfaffd9; backdrop-filter:blur(14px); border-radius:22px; box-shadow:0 28px 50px #17174d55; }
  .back-card { width:185px; height:175px; right:6%; top:21%; transform:rotate(13deg); padding:26px 17px; opacity:.6; }
  .card-microline { display:block; width:90%; height:9px; background:#a9a2e8; border-radius:20px; margin-bottom:12px; opacity:.55; }.card-microline.short{width:45%}
  .front-card { width:216px; height:206px; right:25%; top:18%; transform:rotate(-7deg); padding:23px; background:linear-gradient(135deg,#fffffff0,#e9e8ffdf); }
  .float-header { display:flex; justify-content:space-between; align-items:center; }
  .float-avatar { display:grid; place-items:center; width:44px; height:44px; background:#d3cffb; border-radius:15px; color:#625bdd; }
  .float-tiny { height:7px; width:37px; background:#bdb7e8; border-radius:20px; }
  .float-stack { display:grid; gap:9px; margin-top:20px; }
  .float-stack i { display:block; height:12px; width:91%; border-radius:9px; background:#b5b2dd; opacity:.62; }
  .float-stack i:nth-child(2){width:74%;opacity:.46}.float-stack i:nth-child(3){width:53%;opacity:.32}
  .float-bottom { margin-top:15px; display:flex; gap:8px; }
  .float-bottom span { width:53px; height:18px; border-radius:8px; background:#d4cef5; }
  .float-bottom span:first-child { background:#7772d8; }
  .glow-spark { position:absolute; border-radius:50%; background:#e9e1ff; box-shadow:0 0 0 6px #e9e1ff25,0 0 32px #ffffffcc; }
  .star-a { top:17%; left:6%; width:7px; height:7px; }.star-b { bottom:18%; right:8%; width:5px; height:5px; }
  @keyframes orbit-rotate { to {transform:rotate(337deg)} }
  .workspace-section,.session-section { margin-top:43px; }
  .section-heading { display:flex; justify-content:space-between; align-items:end; gap:12px; margin-bottom:18px; }
  .section-heading h2 { font-size:23px; letter-spacing:-.85px; line-height:1.3; font-weight:710; margin-top:7px; }
  .mini-caption { font-size:11px; color:var(--pt-tertiary); }
  .tool-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:13px; }
  .tool-card { display:flex; position:relative; flex-direction:column; gap:20px; min-width:0; text-align:left; padding:21px; min-height:160px; background:var(--pt-surface); border:1px solid var(--pt-line); border-radius:21px; box-shadow:var(--pt-shadow-small); }
  .tool-icon { display:grid; place-items:center; height:45px; width:45px; border-radius:15px; }
  .tool-purple{background:#eeeaff;color:#6b60e6}.tool-blue{background:#e6f1ff;color:#467fc8}.tool-coral{background:#fff0e9;color:#e37f60}.tool-teal{background:#e4f7f1;color:#188e83}
  .tool-text { display:grid; gap:5px; }.tool-text strong { color:var(--pt-ink); font-size:14px; font-weight:730; }.tool-text small{font-size:11px;color:var(--pt-secondary);line-height:1.4;}
  .tool-arrow { position:absolute; right:18px; top:23px; color:var(--pt-tertiary); transition:transform var(--pt-motion-medium) var(--pt-ease-out); }
  .tool-card:hover .tool-arrow { transform:translate(3px,-3px); color:var(--pt-violet); }
  .all-sessions { display:flex; align-items:center; gap:8px; min-height:44px; padding:0 6px; background:none; color:var(--pt-violet); font-size:12px; font-weight:720; }
  .all-sessions:hover { gap:12px; }
  .session-rows { background:var(--pt-surface); border:1px solid var(--pt-line); border-radius:21px; box-shadow:var(--pt-shadow-small); overflow:hidden; }
  .session-row { display:flex; align-items:center; width:100%; padding:16px 20px; text-align:left; gap:15px; background:none; color:var(--pt-ink); border-bottom:1px solid var(--pt-line); }
  .session-row:last-child { border-bottom:0; }.session-row:hover { background:var(--pt-surface-soft); }
  .session-symbol { display:grid; place-items:center; height:42px; width:42px; flex:none; background:var(--pt-violet-soft); color:var(--pt-violet); border-radius:13px; }
  .session-details { display:grid; gap:5px; flex:1; min-width:0; }
  .session-details strong { font-size:13px; font-weight:750; overflow:hidden;white-space:nowrap;text-overflow:ellipsis; }.session-details small{font-size:11px;color:var(--pt-secondary);}
  .separator { margin:0 3px; color:var(--pt-tertiary); }
  .session-status { font-size:11px; font-weight:660; color:var(--pt-teal); }.session-status.dimmed { color:var(--pt-tertiary); }
  .session-open { color:var(--pt-tertiary); transition:transform var(--pt-motion-medium) ease; }.session-row:hover .session-open { transform:translate(3px,-3px);color:var(--pt-violet); }
  .empty-sessions { display:flex;align-items:center;gap:15px;padding:25px;min-height:132px; }
  .empty-icon { display:grid;place-items:center;width:54px;height:54px;border-radius:17px;background:var(--pt-violet-soft);color:var(--pt-violet);flex:none;}
  .empty-sessions div { flex:1; }.empty-sessions strong{font-size:14px;}.empty-sessions p{font-size:12px;color:var(--pt-secondary);margin-top:6px;}
  .empty-sessions button { display:inline-flex;align-items:center;gap:7px;min-height:43px;padding:0 13px;background:var(--pt-violet-soft);color:var(--pt-violet);font-size:12px;font-weight:750;border-radius:12px; }
  @media(max-width:1130px){.tool-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tool-card{min-height:130px;gap:14px}.hero-copy{width:66%}.hero-art{right:-7%;width:48%}.front-card{right:22%}}
  @media(max-width:720px){
    .home-layout { padding:22px 19px 122px; }
    .machine-pill { font-size:10px; padding:8px 10px; }
    .welcome { margin-bottom:22px; }
    .welcome-headline { display:block; margin-top:22px; }
    h1 { font-size:40px; letter-spacing:-.064em; max-width:400px; }
    .welcome-headline p { font-size:12.5px; max-width:340px; margin-top:10px; }
    .attention-pill { display:inline-flex; margin-top:13px; }
    .hero-card { min-height:298px; border-radius:25px; padding:28px 25px; }
    .hero-copy { width:100%; }
    .hero-overline { font-size:9px; }
    .hero-copy h2 { font-size:31px; max-width:265px; margin-top:27px; }
    .hero-copy p { font-size:12px; max-width:245px; line-height:1.7; }
    .hero-actions { gap:7px; }.hero-cta,.hero-secondary { min-height:43px; border-radius:12px; font-size:11px; padding:0 12px; gap:8px; }
    .hero-secondary { display:none; }
    .hero-foot { font-size:10px; margin-top:18px; }
    .hero-art { right:-26%; width:67%; opacity:.28; }
    .front-card { right:26%; }
    .workspace-section,.session-section { margin-top:31px; }
    .section-heading h2 { font-size:21px; }.mini-caption { display:none; }
    .tool-grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; }
    .tool-card { min-height:138px; padding:17px; gap:15px; border-radius:18px; }
    .tool-icon { height:40px;width:40px;border-radius:13px; }
    .tool-text strong { font-size:13px; }.tool-text small { font-size:10px; }
    .tool-arrow { right:14px;top:17px; }
    .section-heading { margin-bottom:14px; }
    .session-row { padding:14px 15px;gap:10px; }.session-symbol { width:39px;height:39px; }.session-details strong { font-size:12px; }.session-details small{font-size:10px;}
    .session-status { font-size:10px; }.session-open{display:none;}
    .empty-sessions { padding:20px; flex-wrap:wrap; }.empty-sessions button { margin-left:auto; }
  }
  @media(prefers-reduced-motion:reduce){.orbit-two{animation:none}}
</style>