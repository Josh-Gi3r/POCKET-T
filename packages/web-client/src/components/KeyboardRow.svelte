<script lang="ts">
  import { conn } from '../lib/store';

  interface Props {
    disabled?: boolean;
    onInput?: () => void;
  }
  let { disabled = false, onInput }: Props = $props();

  type Key = { label: string; bytes: number[]; emphasized?: boolean; title?: string };
  const keys: Key[] = [
    { label: 'Esc', bytes: [0x1b], title: 'Escape' },
    { label: 'Tab', bytes: [0x09] },
    { label: '↑', bytes: [0x1b, 0x5b, 0x41] },
    { label: '↓', bytes: [0x1b, 0x5b, 0x42] },
    { label: '←', bytes: [0x1b, 0x5b, 0x44] },
    { label: '→', bytes: [0x1b, 0x5b, 0x43] },
    { label: '⌃C', bytes: [0x03], emphasized: true, title: 'Interrupt running process' },
    { label: '⌃D', bytes: [0x04], title: 'End input / exit shell' },
    { label: '⌃Z', bytes: [0x1a], title: 'Suspend process' },
    { label: 'Home', bytes: [0x1b,0x5b,0x48] },
    { label: 'End', bytes: [0x1b,0x5b,0x46] },
    { label: 'Pg↑', bytes: [0x1b,0x5b,0x35,0x7e] },
    { label: 'Pg↓', bytes: [0x1b,0x5b,0x36,0x7e] },
    { label: '⏎', bytes: [0x0d], emphasized: true, title: 'Enter' },
  ];

  function press(key: Key): void {
    if (disabled) return;
    const ok = conn.sendKeyBytes(new Uint8Array(key.bytes));
    if (ok) {
      onInput?.();
      if ('vibrate' in navigator) navigator.vibrate(5);
    }
  }
</script>

<div class="keybar" role="toolbar" aria-label="Terminal special keys">
  {#each keys as key (key.label)}
    <button
      class:emphasized={key.emphasized}
      type="button"
      title={key.title || key.label}
      aria-label={key.title || key.label}
      disabled={disabled}
      onclick={() => press(key)}
    >{key.label}</button>
  {/each}
</div>

<style>
  .keybar{display:flex;flex:none;gap:7px;overflow-x:auto;scrollbar-width:none;padding:9px 13px;background:#101a28;border-top:1px solid #293744;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
  .keybar::-webkit-scrollbar{display:none}
  .keybar button{flex:none;min-width:43px;height:38px;border:1px solid #324554;border-radius:10px;padding:0 10px;background:#1c2b3b;color:#d4e5ea;font:600 12px -apple-system,BlinkMacSystemFont,sans-serif;touch-action:manipulation}
  .keybar button:active:not(:disabled){background:#36514e;transform:scale(.95)}
  .keybar button.emphasized{border-color:#49786f;color:#b7f7db;background:#1e3939}
  .keybar button:disabled{opacity:.35}
  @media(max-width:760px){.keybar{padding:8px 10px;gap:6px}.keybar button{height:38px;min-width:42px}}
</style>
