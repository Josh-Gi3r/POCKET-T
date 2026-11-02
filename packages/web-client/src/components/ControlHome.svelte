<script lang="ts">
  import UiIcon from './UiIcon.svelte';
  import { sessions, current, status, spawnState } from '../lib/store';
  import type { SessionInfo } from '../lib/types';

  type Destination = 'home' | 'terminals' | 'files' | 'apps' | 'machine' | 'vault';
  let {
    onNavigate, onOpenSession, onNewTerminal, onCommand,
  }: {
    onNavigate: (target: Destination) => void;
    onOpenSession: (sessionId: string) => void;
    onNewTerminal: () => void;
    onCommand: () => void;
  } = $props();

  const online = $derived($status === 'open');
  const live = $derived($sessions.filter((s) => !s.detached));
  const featured = $derived($sessions.find((s) => s.sessionId === $current) ?? live[0] ?? $sessions[0] ?? null);
  const recent = $derived($sessions.slice(0, 5));
  const pending = $derived($sessions.reduce((sum, s) => sum + s.pendingApprovals, 0));

  function titleOf(s: SessionInfo): string {
    return s.cwd.split('/').filter(Boolean).at(-1) || 'Untitled session';
  }
  function kindOf(s: SessionInfo): string {
    if (s.sessionId.startsWith('join-')) return 'Joined tmux';
    if (s.vendor === 'claude') return 'Claude Code';
    if (s.vendor === 'codex') return 'Codex';
    return s.vendor ? s.vendor.charAt(0).toUpperCase() + s.vendor.slice(1) : 'Shell';
  }
  function timeAgo(ts: number): string {
    const delta = Math.max(0, Date.now() - ts);
    if (delta < 60_000) return 'Just now';
    if (delta < 3_600_000) return Math.floor(delta / 60_000) + 'm ago';
    if (delta < 86_400_000) return Math.floor(delta / 3_600_000) + 'h ago';
    return Math.floor(delta / 86_400_000) + 'd ago';
  }
  function begin(): void {
    if (featured) onOpenSession(featured.sessionId);
    else onNewTerminal();
  }
</script>

<section class="overview" aria-label="Pocket-T home">
  <div class="overview-content">
    <header class="overview-topline">
      <span class="overline"><span class="small-star">✦</span> YOUR CONTROL SPACE</span>
      <button class="global-shortcut" onclick={onCommand} aria-label="Open command center">
        <UiIcon name="search" size={17}/>
        <span>Search anything</span>
        <kbd>⌘ K</kbd>
      </button>
    </header>

    <div class="hero" aria-label="Your machine is within reach">
      <div class="hero-copy">
        <div class="hero-eyebrow"><span class="eyebrow-indicator"></span> THE DISTANCE DISAPPEARS</div>
        <h1>Everything,<br/><span>within reach.</span></h1>
        <p>Your real computer. Your running work. One beautiful space to stay in control, wherever you are.</p>
        <div class="hero-actions">
          <button class="hero-primary" onclick={begin} disabled={!online && !featured}>
            <span>{featured ? 'Continue session' : 'Open a terminal'}</span>
            <span class="arrow-circle"><UiIcon name="arrow-up-right" size={18}/></span>
          </button>
          <button class="hero-secondary" onclick={() => onNavigate('terminals')}>
            Explore your sessions <UiIcon name="arrow-right" size={16}/>
          </button>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="art-orbit art-orbit-one"></div>
        <div class="art-orbit art-orbit-two"></div>
        <div class="art-glow"></div>
        <div class="art-satellite art-satellite-left"><UiIcon name="layers" size={19}/></div>
        <div class="art-satellite art-satellite-right"><UiIcon name="activity" size={19}/></div>
        <div class="glass-device">
          <div class="device-sheen"></div>
          <div class="device-bar"><span class="tiny-symbol">✦</span><span>POCKET-T · LOCAL</span><span class="device-micro-led"></span></div>
          <div class="device-center">
            <div class="device-pulse-ring"><span><UiIcon name="computer" size={38} strokeWidth={1.3}/></span></div>
            <strong>Your Mac</strong>
            <span>{online ? 'Connection active' : 'Awaiting connection'}</span>
          </div>
          <div class="device-bottom"><span class="sparkle-mark">✳</span><span>{online ? 'Connected & ready' : 'Currently offline'}</span><span class="device-arrow">↗</span></div>
        </div>
        <div class="art-dot dot-a"></div><div class="art-dot dot-b"></div><div class="art-dot dot-c"></div>
      </div>
      <div class="hero-index">01 / YOUR SPACE</div>
    </div>

    <div class="metrics" aria-label="Live machine statistics">
      <div class="metric">
        <span class="metric-icon purple"><UiIcon name="layers" size={18}/></span>
        <span class="metric-label">Running sessions</span>
        <div class="metric-value">{live.length.toString().padStart(2,'0')}<small>Live on your Mac</small></div>
      </div>
      <div class="metric">
        <span class="metric-icon coral"><UiIcon name="activity" size={18}/></span>
        <span class="metric-label">Needs attention</span>
        <div class="metric-value">{pending.toString().padStart(2,'0')}<small>{pending ? 'Pending approvals' : 'All clear for now'}</small></div>
      </div>
      <div class="metric">
        <span class="metric-icon blue"><UiIcon name="wifi" size={18}/></span>
        <span class="metric-label">Machine link</span>
        <div class="metric-value small-value">{online ? 'Online' : 'Offline'}<small>{online ? 'Ready for commands' : 'Not connected'}</small></div>
      </div>
    </div>

    <div class="section-heading">
      <div>
        <span class="section-eyebrow">PICK UP THE THREAD</span>
        <h2>Your live workspace<span>.</span></h2>
      </div>
      <button class="section-link" onclick={() => onNavigate('terminals')}>All sessions <UiIcon name="arrow-right" size={17}/></button>
    </div>

    <div class="work-grid">
      {#if recent.length}
        {#each recent as s, i (s.sessionId)}
          <button class:feature-session={i === 0} class="work-card" onclick={() => onOpenSession(s.sessionId)}>
            <span class="work-card-top">
              <span class="work-icon" class:agent={!!s.vendor}>{s.vendor === 'claude' ? '✳' : s.vendor === 'codex' ? '◇' : '⌘'}</span>
              <span class:offline={s.detached || !online} class="work-live"><span></span>{s.detached ? 'DETACHED' : !online ? 'OFFLINE' : 'LIVE'}</span>
            </span>
            <span class="work-card-content">
              <strong>{titleOf(s)}</strong>
              <span>{kindOf(s)} · {timeAgo(s.lastActiveAt)}</span>
            </span>
            <span class="work-card-foot">
              <span>{s.cwd}</span>
              <span class="work-card-arrow"><UiIcon name="arrow-up-right" size={19}/></span>
            </span>
          </button>
        {/each}
      {:else}
        <div class="no-sessions">
          <div class="no-sessions-icon"><UiIcon name="terminal" size={29}/></div>
          <div class="no-sessions-content"><strong>Your next session starts here.</strong><p>Start a real shell on your Mac. No AI account or tokens required.</p></div>
          <button onclick={onNewTerminal} disabled={!online || $spawnState.status === 'starting'}>Start session <UiIcon name="arrow-up-right" size={18}/></button>
        </div>
      {/if}
    </div>

    <div class="section-heading tools-heading">
      <div>
        <span class="section-eyebrow">MORE WAYS TO WORK</span>
        <h2>Everything connected<span>.</span></h2>
      </div>
    </div>
    <div class="tool-grid">
      <button class="tool-card" onclick={() => onNavigate('files')}>
        <span class="tool-icon violet"><UiIcon name="files" size={23}/></span>
        <span><strong>Files & folders</strong><small>Browse approved Mac directories</small></span>
        <UiIcon name="arrow-up-right" size={19}/>
      </button>
      <button class="tool-card" onclick={() => onNavigate('apps')}>
        <span class="tool-icon sky"><UiIcon name="apps" size={23}/></span>
        <span><strong>Applications</strong><small>Launch permitted Mac apps</small></span>
        <UiIcon name="arrow-up-right" size={19}/>
      </button>
      <button class="tool-card" onclick={() => onNavigate('machine')}>
        <span class="tool-icon mint"><UiIcon name="computer" size={23}/></span>
        <span><strong>Your machine</strong><small>Connection & device capabilities</small></span>
        <UiIcon name="arrow-up-right" size={19}/>
      </button>
    </div>
    <div class="overview-footer"><span>POWER UNDERNEATH. EASE ON THE SURFACE.</span><span>POCKET-T / CONTROL SPACE</span></div>
  </div>
</section>

<style>
  .overview{height:100%;flex:1;overflow-y:auto;overflow-x:hidden;min-height:0;color:var(--pt-text);-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:var(--pt-line) transparent}
  .overview-content{max-width:1310px;margin:0 auto;padding:33px clamp(24px,4.8vw,74px) 62px;position:relative}
  .overview-topline{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:25px}
  .overline,.hero-eyebrow,.section-eyebrow{font-size:10px;font-weight:850;letter-spacing:1.7px;color:var(--pt-muted)}
  .small-star{color:var(--pt-accent);font-size:17px;vertical-align:-2px;margin-right:7px}
  .global-shortcut{display:flex;align-items:center;gap:12px;background:var(--pt-glass);color:var(--pt-secondary);border:1px solid var(--pt-line);border-radius:15px;min-width:220px;padding:10px 10px 10px 14px;font-size:12px;text-align:left;box-shadow:0 4px 22px #1c224211;transition:transform .22s ease,box-shadow .22s ease,background .22s}
  .global-shortcut span{flex:1}.global-shortcut kbd{padding:5px 6px;background:var(--pt-subtle);border-radius:6px;font-size:10px;color:var(--pt-secondary)}
  .global-shortcut:hover{transform:translateY(-2px);box-shadow:0 12px 28px #26295118}
  .hero{background:linear-gradient(110deg,#171f47 0%,#222960 48%,#303283 100%);border-radius:28px;min-height:372px;display:flex;position:relative;overflow:hidden;isolation:isolate;box-shadow:0 22px 65px #25275e25}
  .hero:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 72% 52%,#8278e777,transparent 37%),radial-gradient(circle at 95% 5%,#4ed8e43b,transparent 41%);pointer-events:none}
  .hero-copy{position:relative;z-index:3;width:57%;padding:48px 0 47px 53px}
  .hero-eyebrow{color:#bbd2ff;letter-spacing:2.1px;display:flex;align-items:center;gap:9px}
  .eyebrow-indicator{width:7px;height:7px;background:#9ef9dd;border-radius:50%;box-shadow:0 0 18px #93efd7}
  .hero h1{font-size:clamp(42px,4.85vw,68px);line-height:1.06;letter-spacing:-3px;font-weight:700;margin:29px 0 18px;color:#fff}
  .hero h1 span{color:#c8c7ff;font-weight:520}
  .hero p{color:#bbc6e7;font-size:14px;line-height:1.8;margin:0;max-width:385px}
  .hero-actions{display:flex;align-items:center;gap:17px;margin-top:29px;flex-wrap:wrap}
  .hero-primary{display:flex;align-items:center;gap:16px;border:0;background:#fff;color:#24244f;border-radius:14px;padding:6px 6px 6px 19px;min-height:48px;font-size:12px;font-weight:800;transition:transform .28s cubic-bezier(.2,1,.2,1),box-shadow .28s}
  .hero-primary:disabled{opacity:.45;cursor:not-allowed}.hero-primary:not(:disabled):hover{transform:translateY(-3px);box-shadow:0 14px 32px #070c2755}
  .arrow-circle{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:#635cfa;color:#fff}
  .hero-secondary{display:flex;align-items:center;gap:9px;border:0;color:#e4e9ff;background:none;font-size:12px;font-weight:700;padding:13px 4px}
  .hero-secondary:hover{color:#aef7e6}
  .hero-art{position:absolute;inset:0 0 0 49%;z-index:2;display:grid;place-items:center}
  .art-orbit{position:absolute;width:390px;height:390px;border-radius:50%;border:1px solid #c8d7ff2b;transform:rotate(-15deg)}
  .art-orbit-one:before{content:"";position:absolute;left:60px;top:8px;width:8px;height:8px;background:#9ef5da;box-shadow:0 0 14px #aaffeb;border-radius:50%}
  .art-orbit-two{width:288px;height:288px;border-color:#fefcfe33;animation:orbit 48s linear infinite}
  .art-glow{position:absolute;width:310px;height:310px;border-radius:50%;background:#b9b2ff59;filter:blur(70px)}
  .glass-device{position:relative;width:216px;height:270px;background:linear-gradient(135deg,#e4e8ff5c,#c6e3ff18 55%,#8e87f44f);border:1px solid #ffffff73;border-radius:26px;box-shadow:0 30px 65px #10134d82,inset 0 1px #fff9;transform:rotate(9deg) translateX(-5px);overflow:hidden;backdrop-filter:blur(28px);animation:device-float 8s ease-in-out infinite}
  .device-sheen{position:absolute;inset:0;background:linear-gradient(150deg,#fff5,transparent 38%,#fff1 70%,transparent)}
  .device-bar{position:relative;z-index:1;height:45px;display:flex;align-items:center;gap:6px;padding:0 14px;color:#e6eaff;font-size:8px;font-weight:800;letter-spacing:1px;border-bottom:1px solid #ffffff38}
  .tiny-symbol{font-size:20px}.device-micro-led{margin-left:auto;width:6px;height:6px;border-radius:50%;background:#a9ffe3}
  .device-center{display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;height:174px;gap:8px;color:#fff}
  .device-pulse-ring{height:110px;width:110px;border:1px solid #f2f5ff70;display:grid;place-items:center;border-radius:50%;box-shadow:0 0 0 15px #d3e0ff12,0 0 0 34px #d3e0ff0a}
  .device-pulse-ring>span{height:74px;width:74px;display:grid;place-items:center;border-radius:22px;background:linear-gradient(135deg,#fafaffab,#d6d9ff5e);box-shadow:inset 0 1px #fff7;color:#fff}
  .device-center strong{font-size:14px;font-weight:800}.device-center>span{color:#e2e6ff;font-size:9px}
  .device-bottom{height:50px;position:relative;border-top:1px solid #ffffff40;display:flex;align-items:center;gap:7px;padding:0 12px;color:#f5fbff;font-size:9px}
  .sparkle-mark{font-size:15px;color:#a8ffe9}.device-arrow{margin-left:auto;font-size:18px}
  .art-satellite{position:absolute;z-index:3;width:55px;height:55px;display:grid;place-items:center;border-radius:17px;color:#fff;border:1px solid #ffffff88;background:#ffffff34;box-shadow:0 18px 33px #12194b57;backdrop-filter:blur(18px)}
  .art-satellite-left{left:16%;top:19%;transform:rotate(-12deg)}.art-satellite-right{right:12%;bottom:18%;transform:rotate(11deg)}
  .art-dot{position:absolute;border-radius:50%;background:#e5f9ff;opacity:.68}.dot-a{height:3px;width:3px;top:17%;right:28%}.dot-b{height:4px;width:4px;bottom:23%;left:18%}.dot-c{height:3px;width:3px;bottom:18%;right:45%}
  .hero-index{position:absolute;right:24px;bottom:22px;color:#c3c5ef8a;font-size:9px;font-weight:750;letter-spacing:1.5px;z-index:3}
  @keyframes orbit{to{transform:rotate(345deg)}}@keyframes device-float{50%{transform:rotate(7deg) translate(-8px,-8px)}}
  .metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:18px 0 40px}
  .metric{position:relative;display:grid;grid-template-columns:auto 1fr;gap:8px 12px;padding:19px 20px;border-radius:18px;background:var(--pt-glass);border:1px solid var(--pt-line);box-shadow:0 5px 28px #15223b07}
  .metric-icon{grid-row:1/3;align-self:start;width:40px;height:40px;display:grid;place-items:center;border-radius:13px}
  .purple{background:#ebe6ff;color:#6657da}.coral{background:#ffede9;color:#d67765}.blue{background:#e0f4ff;color:#4b8fc1}
  .metric-label{color:var(--pt-secondary);font-size:11px;font-weight:670;align-self:center}
  .metric-value{display:flex;align-items:center;gap:10px;font-size:27px;line-height:1;font-weight:750;letter-spacing:-1px}
  .metric-value.small-value{font-size:23px}.metric-value small{font-size:10px;color:var(--pt-muted);font-weight:500;letter-spacing:0}
  .section-heading{display:flex;align-items:end;justify-content:space-between;gap:13px;margin-bottom:19px}
  .section-eyebrow{color:var(--pt-accent);font-size:9px}
  .section-heading h2{font-size:clamp(24px,2.5vw,30px);font-weight:720;letter-spacing:-1.1px;margin:7px 0 0}
  .section-heading h2 span{color:var(--pt-accent)}
  .section-link{display:flex;align-items:center;gap:8px;background:transparent;border:0;color:var(--pt-secondary);font-size:11px;font-weight:740;padding:9px 0;white-space:nowrap}
  .section-link:hover{color:var(--pt-accent)}
  .work-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}
  .work-card{min-height:180px;display:flex;flex-direction:column;justify-content:space-between;text-align:left;padding:20px;border-radius:20px;background:var(--pt-glass);border:1px solid var(--pt-line);color:var(--pt-text);box-shadow:0 8px 26px #1e254008;min-width:0;position:relative;transition:transform .35s cubic-bezier(.18,1,.3,1),box-shadow .3s,border-color .3s}
  .work-card:hover{transform:translateY(-4px);border-color:var(--pt-accent-border);box-shadow:0 22px 42px #23295c20}
  .work-card:active{transform:translateY(-1px) scale(.99)}
  .work-card.feature-session{background:linear-gradient(115deg,#eef0ff,#f8f7ff);border-color:#d7dafa;color:#212449}
  .work-card-top,.work-card-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%}
  .work-icon{height:42px;width:42px;border-radius:14px;display:grid;place-items:center;background:#e3e9fd;color:#586bb5;font-size:18px;font-weight:800}
  .work-icon.agent{background:#e9dfff;color:#865fd0;font-size:23px}
  .work-live{display:flex;align-items:center;gap:6px;font-size:9px;letter-spacing:.8px;font-weight:830;color:#468f79}
  .work-live span{height:6px;width:6px;border-radius:50%;background:#6bc3a7;box-shadow:0 0 9px #64bca98a}
  .work-live.offline{color:#ad8d89}.work-live.offline span{background:#d7aaa2;box-shadow:none}
  .work-card-content{display:grid;gap:7px;margin:16px 0 18px}
  .work-card-content strong{font-size:18px;letter-spacing:-.4px;font-weight:780;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .work-card-content>span{font-size:11px;color:#808ca9}
  .work-card-foot>span:first-child{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:#8490a6;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
  .work-card-arrow{height:34px;width:34px;border-radius:11px;display:grid;place-items:center;color:#5862e9;background:#e6e8ff;flex:none;transition:transform .3s}
  .work-card:hover .work-card-arrow{transform:translate(2px,-2px)}
  .no-sessions{grid-column:1/-1;background:var(--pt-glass);border:1px solid var(--pt-line);border-radius:20px;display:flex;align-items:center;padding:23px;gap:17px;box-shadow:0 8px 26px #202a4b08}
  .no-sessions-icon{height:56px;width:56px;border-radius:17px;background:var(--pt-subtle);color:var(--pt-accent);display:grid;place-items:center;flex:none}
  .no-sessions-content{flex:1;min-width:0}.no-sessions-content strong{font-size:16px}.no-sessions-content p{font-size:12px;color:var(--pt-secondary);margin:7px 0 0}
  .no-sessions button{display:flex;align-items:center;gap:7px;background:var(--pt-accent);color:#fff;border:0;border-radius:12px;padding:12px 16px;font-size:11px;font-weight:750}
  .no-sessions button:disabled{opacity:.4}
  .tools-heading{margin-top:42px}
  .tool-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .tool-card{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;background:var(--pt-glass);border:1px solid var(--pt-line);border-radius:17px;padding:18px 16px;color:var(--pt-text);text-align:left;min-width:0;transition:transform .28s cubic-bezier(.2,1,.3,1),box-shadow .28s,border-color .28s}
  .tool-card:hover{transform:translateY(-3px);box-shadow:0 18px 34px #28305a15;border-color:var(--pt-accent-border)}
  .tool-card>span:nth-child(2){display:grid;gap:6px;min-width:0}.tool-card strong{font-size:12px;font-weight:780}.tool-card small{font-size:10px;color:var(--pt-secondary);line-height:1.4}
  .tool-card>svg{color:var(--pt-muted)}
  .tool-icon{height:43px;width:43px;display:grid;place-items:center;border-radius:13px}
  .violet{background:#ece5ff;color:#7859cc}.sky{background:#e5f2ff;color:#578fcc}.mint{background:#dbf5eb;color:#328f72}
  .overview-footer{margin-top:40px;border-top:1px solid var(--pt-line);padding:19px 0;display:flex;align-items:center;justify-content:space-between;font-size:9px;font-weight:800;letter-spacing:1.3px;color:var(--pt-muted)}
  @media(max-width:1130px){
    .hero-copy{width:62%;padding:43px 0 42px 39px}.hero-art{left:49%}.hero h1{font-size:49px}
    .art-orbit{width:330px;height:330px}.art-orbit-two{height:245px;width:245px}.glass-device{transform:scale(.86) rotate(9deg)}
    .tool-grid{grid-template-columns:1fr}.tool-card{padding:13px 16px}
  }
  @media(max-width:720px){
    .overview-content{padding:21px 17px calc(env(safe-area-inset-bottom,0px) + 112px)}
    .overview-topline{margin-bottom:17px}.overline{font-size:9px;letter-spacing:1.25px}.global-shortcut{min-width:0;padding:10px;border-radius:12px}.global-shortcut span,.global-shortcut kbd{display:none}
    .hero{border-radius:24px;min-height:361px;display:block}
    .hero-copy{width:100%;padding:31px 25px 34px}.hero-eyebrow{font-size:9px;letter-spacing:1.6px}
    .hero h1{font-size:clamp(40px,10.8vw,50px);line-height:1.08;letter-spacing:-2.3px;margin:19px 0 13px;max-width:310px}
    .hero p{font-size:12px;line-height:1.7;max-width:265px}
    .hero-actions{margin-top:23px;gap:9px}.hero-primary{min-height:44px;padding:5px 5px 5px 14px;font-size:11px;gap:10px}
    .hero-secondary{font-size:10px}.arrow-circle{width:34px;height:34px}
    .hero-art{left:36%;top:18%;opacity:.53;transform:scale(.75);transform-origin:center;pointer-events:none;z-index:1}
    .hero-copy{z-index:3}.hero-index{font-size:8px}
    .metrics{gap:8px;margin:12px 0 31px}
    .metric{padding:13px 10px;border-radius:15px;grid-template-columns:1fr;gap:6px}
    .metric-icon{width:30px;height:30px;border-radius:9px;grid-row:auto}.metric-label{font-size:9px;line-height:1.3}
    .metric-value,.metric-value.small-value{display:block;font-size:24px}.metric-value.small-value{font-size:16px}
    .metric-value small{font-size:8px;display:block;margin-top:6px;line-height:1.4;min-height:17px}
    .section-heading{margin-bottom:13px}.section-heading h2{font-size:23px}.section-link{font-size:10px}
    .work-grid{grid-template-columns:1fr;gap:10px}.work-card{min-height:154px;padding:17px}
    .work-card-content{margin:12px 0}.work-card-content strong{font-size:17px}
    .no-sessions{flex-wrap:wrap;padding:17px}.no-sessions-icon{height:48px;width:48px}.no-sessions-content strong{font-size:14px}.no-sessions button{width:100%;justify-content:center}
    .tools-heading{margin-top:28px}.tool-grid{grid-template-columns:1fr;gap:9px}.tool-card{padding:13px 15px}
    .overview-footer{margin-top:25px;font-size:8px}.overview-footer span:last-child{display:none}
  }
  @media(prefers-reduced-motion:reduce){.art-orbit-two,.glass-device{animation:none}.work-card,.tool-card,.hero-primary{transition:none}}
</style>
