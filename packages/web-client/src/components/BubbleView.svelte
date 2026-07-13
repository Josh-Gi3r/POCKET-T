<script lang="ts">
  import { tick } from 'svelte';
  import Bubble from './Bubble.svelte';
  import { bubbles } from '../lib/store';

  let { sessionId }: { sessionId: string } = $props();

  const list = $derived($bubbles[sessionId] ?? []);
  let scroller = $state<HTMLDivElement | null>(null);
  let pinned = true;

  // Auto-scroll to newest, but only if the user is already near the bottom
  // (don't yank them up while they're reading history).
  $effect(() => {
    void list.length;
    if (!scroller) return;
    if (pinned) tick().then(() => scroller && (scroller.scrollTop = scroller.scrollHeight));
  });

  function onScroll() {
    if (!scroller) return;
    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    pinned = gap < 80;
  }
</script>

<div class="scroller" bind:this={scroller} onscroll={onScroll}>
  {#if list.length === 0}
    <div class="hint">
      <p>Waiting for agent activity…</p>
      <p class="sub">
        Conversation, thinking, tool calls, and approvals appear here as cards. Type below to talk to
        the agent, or open the <b>Terminal</b> tab for raw output.
      </p>
    </div>
  {:else}
    <div class="stack">
      {#each list as ev, i (i)}
        <Bubble {ev} {sessionId} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 12px calc(var(--safe-right) + 12px) 12px calc(var(--safe-left) + 12px);
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .hint {
    color: var(--text-dim);
    text-align: center;
    margin-top: 40px;
    padding: 0 24px;
  }
  .hint .sub {
    font-size: 13px;
    line-height: 1.5;
  }
</style>
