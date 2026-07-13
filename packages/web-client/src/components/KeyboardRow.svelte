<script lang="ts">
  import { conn } from '../lib/store';

  // Touch keyboard row for the terminal view — keys a soft keyboard can't
  // send. Each entry is raw bytes written to the PTY via INPUT_KEY.
  const keys: { label: string; bytes: number[] }[] = [
    { label: 'Esc', bytes: [0x1b] },
    { label: 'Tab', bytes: [0x09] },
    { label: '⌃C', bytes: [0x03] },
    { label: '⌃D', bytes: [0x04] },
    { label: '⌃Z', bytes: [0x1a] },
    { label: '⌃L', bytes: [0x0c] },
    { label: '↑', bytes: [0x1b, 0x5b, 0x41] },
    { label: '↓', bytes: [0x1b, 0x5b, 0x42] },
    { label: '←', bytes: [0x1b, 0x5b, 0x44] },
    { label: '→', bytes: [0x1b, 0x5b, 0x43] },
    { label: '⏎', bytes: [0x0d] },
  ];

  function press(bytes: number[]) {
    conn.sendKeyBytes(new Uint8Array(bytes));
    if (navigator.vibrate) navigator.vibrate(4);
  }
</script>

<div class="kbrow">
  {#each keys as k (k.label)}
    <button onclick={() => press(k.bytes)}>{k.label}</button>
  {/each}
</div>

<style>
  .kbrow {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding: 8px calc(var(--safe-right) + 10px) 8px calc(var(--safe-left) + 10px);
    border-bottom: 1px solid var(--border);
    scrollbar-width: none;
  }
  .kbrow::-webkit-scrollbar {
    display: none;
  }
  .kbrow button {
    flex: none;
    min-width: 44px;
    height: 36px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
  }
  .kbrow button:active {
    background: var(--accent-dim);
  }
</style>
