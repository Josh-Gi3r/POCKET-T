<script lang="ts">
  import { tick } from 'svelte';
  import Bubble from './Bubble.svelte';
  import { bubbles } from '../lib/store';

  let { sessionId }: { sessionId: string } = $props();
  const list = $derived($bubbles[sessionId] ?? []);
  let scroller = $state<HTMLElement | null>(null);
  let pinned = true;

  $effect(() => {
    void list.length;
    if (scroller && pinned) {
      tick().then(() => {
        if (scroller && pinned) scroller.scrollTop = scroller.scrollHeight;
      });
    }
  });

  function onScroll() {
    if (!scroller) return;
    pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 100;
  }
</script>

<section class="activity" bind:this={scroller} onscroll={onScroll} aria-label="Live session activity">
  {#if list.length === 0}
    <div class="quiet-state">
      <div class="signal">
        <span></span><span></span><span></span><span></span><span></span>
      </div>
      <div class="quiet-eyebrow">READY WHEN YOU ARE</div>
      <h2>Your session is live.</h2>
      <p>Agent conversations, tool calls and approvals will appear here as they happen. Start with a one-tap action below, speak, or open the Terminal tab.</p>
      <span class="quiet-foot">The actual shell keeps running on your Mac.</span>
    </div>
  {:else}
    <div class="activity-head"><span>LIVE ACTIVITY</span><span>{list.length} EVENTS</span></div>
    <div class="timeline">
      {#each list as ev, i (i)}
        <Bubble {ev} {sessionId} />
      {/each}
    </div>
    <div class="bottom-marker">YOU'RE UP TO DATE <span>✳</span></div>
  {/if}
</section>

<style>
  .activity{flex:1;overflow:auto;overscroll-behavior:contain;min-height:0;scrollbar-width:thin;scrollbar-color:#315149 transparent;padding:24px clamp(18px,3.5vw,46px) 26px;background:radial-gradient(ellipse at 50% 0%,rgba(29,82,74,.08),transparent 70%);-webkit-overflow-scrolling:touch}
  .activity-head{display:flex;justify-content:space-between;align-items:center;color:#6b8591;letter-spacing:1.5px;font-size:9px;font-weight:850;margin-bottom:20px}
  .timeline{display:flex;flex-direction:column;gap:13px;max-width:980px;margin:auto}
  .bottom-marker{text-align:center;color:#6c9c8d;font-size:9px;letter-spacing:1.5px;font-weight:750;margin-top:26px}.bottom-marker span{margin-left:7px;color:#a2f0cb}
  .quiet-state{display:flex;flex-direction:column;align-items:center;text-align:center;justify-content:center;min-height:100%;max-width:390px;margin:auto;padding:32px 0}
  .signal{height:95px;display:flex;align-items:center;gap:7px}.signal span{width:5px;border-radius:3px;background:linear-gradient(#aafad7,#3c907a);box-shadow:0 0 17px rgba(116,233,180,.18)}
  .signal span:nth-child(1),.signal span:nth-child(5){height:20px}.signal span:nth-child(2),.signal span:nth-child(4){height:44px}.signal span:nth-child(3){height:72px}
  .quiet-eyebrow{font-size:9px;font-weight:850;letter-spacing:2px;color:#85beab;margin-top:7px}
  .quiet-state h2{font-size:25px;letter-spacing:-.8px;font-weight:680;margin:15px 0 8px}.quiet-state p{font-size:13px;color:#8fa5ae;line-height:1.8;margin:0}
  .quiet-foot{margin-top:23px;font-size:10px;color:#5f8184}
  @media(max-width:760px){.activity{padding:17px 15px 22px}.quiet-state{padding:22px 0;min-height:300px}.quiet-state h2{font-size:22px}.quiet-state p{font-size:12px}.activity-head{margin-bottom:13px}}
</style>
