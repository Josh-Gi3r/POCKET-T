<script lang="ts">
  import { resolveApproval } from '../lib/store';
  import type { BubbleEvent } from '../lib/types';

  let { ev, sessionId }: { ev: BubbleEvent; sessionId: string } = $props();

  const isApprovalResolved = $derived(ev.kind === 'approval' && /^[✓✗]/.test(ev.text ?? ''));

  function paramPreview(p: Record<string, unknown> | undefined): string {
    if (!p) return '';
    // Prefer the fields agents most commonly carry.
    const keys = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description'];
    for (const k of keys) if (typeof p[k] === 'string') return p[k] as string;
    try {
      return JSON.stringify(p);
    } catch {
      return '';
    }
  }

  let expanded = $state(false);
</script>

<div class="bubble kind-{ev.kind}" class:assistant={ev.role === 'assistant'} class:user={ev.role === 'user'}>
  {#if ev.kind === 'chat'}
    <div class="role">{ev.role === 'user' ? 'You' : 'Agent'}</div>
    <div class="text">{ev.text}</div>
  {:else if ev.kind === 'thought'}
    <div class="label">✳︎ thinking</div>
    <div class="text dim">{ev.text}</div>
  {:else if ev.kind === 'action'}
    <div class="label">▸ {ev.tool ?? 'tool'}</div>
    <div class="text mono param">{paramPreview(ev.parameters)}</div>
  {:else if ev.kind === 'tool_result'}
    <button class="label toggle" onclick={() => (expanded = !expanded)}>
      ✓ result {expanded ? '▾' : '▸'}
    </button>
    {#if expanded}
      <pre class="mono out">{ev.output ?? ev.text ?? ''}</pre>
    {:else}
      <div class="text mono dim one-line">{(ev.output ?? ev.text ?? '').split('\n')[0]}</div>
    {/if}
  {:else if ev.kind === 'approval'}
    <div class="label appr-label">🔐 approval — {ev.tool ?? 'tool'}</div>
    <div class="text mono param">{paramPreview(ev.parameters)}</div>
    {#if !isApprovalResolved && ev.approvalId}
      <div class="appr-actions">
        <button class="deny" onclick={() => resolveApproval(sessionId, ev.approvalId!, 'deny')}
          >Deny</button
        >
        <button class="approve" onclick={() => resolveApproval(sessionId, ev.approvalId!, 'approve')}
          >Approve</button
        >
      </div>
    {:else}
      <div class="text">{ev.text}</div>
    {/if}
  {:else if ev.kind === 'error'}
    <div class="label err-label">⚠ error</div>
    <div class="text">{ev.text}</div>
  {/if}
</div>

<style>
  .bubble {
    border-radius: 14px;
    padding: 10px 13px;
    max-width: 88%;
    align-self: flex-start;
    border: 1px solid var(--border);
    background: var(--bg-card);
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .bubble.user {
    align-self: flex-end;
    background: var(--user);
    border-color: transparent;
  }
  .kind-thought {
    background: var(--thought);
  }
  .kind-action {
    background: var(--action);
  }
  .kind-tool_result {
    background: var(--result);
  }
  .kind-approval {
    background: var(--approval);
    border-color: #6b4a12;
    max-width: 100%;
    align-self: stretch;
  }
  .kind-error {
    background: var(--error);
    border-color: var(--danger);
  }
  .role {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
    margin-bottom: 3px;
  }
  .label {
    font-size: 12px;
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 4px;
  }
  .appr-label {
    color: #e0b33f;
  }
  .err-label {
    color: var(--danger);
  }
  .toggle {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
  }
  .text {
    font-size: 14px;
    line-height: 1.4;
    white-space: pre-wrap;
  }
  .param {
    font-size: 12px;
    color: var(--text);
    white-space: pre-wrap;
  }
  .dim {
    color: var(--text-dim);
  }
  .one-line {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .out {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.35;
    max-height: 260px;
    overflow: auto;
    background: rgba(0, 0, 0, 0.25);
    padding: 8px;
    border-radius: 8px;
    white-space: pre-wrap;
  }
  .appr-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .appr-actions button {
    flex: 1;
    border: none;
    border-radius: 8px;
    padding: 10px;
    font-weight: 700;
  }
  .approve {
    background: var(--accent);
    color: #04150c;
  }
  .deny {
    background: var(--error);
    color: var(--danger);
    border: 1px solid var(--danger) !important;
  }
</style>
