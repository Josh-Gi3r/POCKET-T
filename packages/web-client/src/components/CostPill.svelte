<script lang="ts">
  import { cost, current } from '../lib/store';

  const c = $derived($current ? $cost[$current] : undefined);
  const usd = $derived(
    c?.cumulativeCostUSD != null ? `$${c.cumulativeCostUSD.toFixed(2)}` : null,
  );
</script>

{#if usd}
  <div class="pill" title={c?.model ?? ''}>
    <span class="usd">{usd}</span>
    {#if c?.model}<span class="model">{c.model.replace(/^claude-/, '')}</span>{/if}
  </div>
{/if}

<style>
  .pill {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 12px;
  }
  .usd {
    font-weight: 700;
    color: var(--accent);
  }
  .model {
    color: var(--text-dim);
    font-size: 10px;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
