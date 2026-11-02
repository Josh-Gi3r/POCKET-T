<script lang="ts">
  type Name =
    | 'grid' | 'terminal' | 'files' | 'apps' | 'computer' | 'lock' | 'search'
    | 'command' | 'plus' | 'arrow-right' | 'arrow-up-right' | 'chevron-right'
    | 'chevron-left' | 'sparkle' | 'sun' | 'moon' | 'menu' | 'close'
    | 'circle-check' | 'layers' | 'wifi' | 'activity' | 'more' | 'keyboard';
  let { name, size = 20, strokeWidth = 1.8 }: { name: Name; size?: number; strokeWidth?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'grid'}
    <rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>
  {:else if name === 'terminal'}
    <rect x="3" y="4" width="18" height="16" rx="4"/><path d="m7.7 9 3 3-3 3M13.5 15H17"/>
  {:else if name === 'files'}
    <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H12l3 3h2.5A2.5 2.5 0 0 1 20 8.5v9A2.5 2.5 0 0 1 17.5 20h-10A2.5 2.5 0 0 1 5 17.5z"/><path d="M5 8h15"/>
  {:else if name === 'apps'}
    <rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><circle cx="17" cy="17" r="3.5"/>
  {:else if name === 'computer'}
    <rect x="3" y="4" width="18" height="14" rx="3"/><path d="M8 22h8M12 18v4"/>
  {:else if name === 'lock'}
    <rect x="4.5" y="10" width="15" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1"/>
  {:else if name === 'search'}
    <circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>
  {:else if name === 'command'}
    <path d="M9 8V6a3 3 0 1 0-3 3h2m8 0h2a3 3 0 1 0-3-3v2m0 8v2a3 3 0 1 0 3-3h-2m-8 0H6a3 3 0 1 0 3 3v-2z"/><path d="M9 9h6v6H9z"/>
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14"/>
  {:else if name === 'arrow-right'}
    <path d="M4.5 12h15m-6-6 6 6-6 6"/>
  {:else if name === 'arrow-up-right'}
    <path d="M5.5 18.5 18.5 5.5M8 5.5h10.5V16"/>
  {:else if name === 'chevron-right'}
    <path d="m9 5 7 7-7 7"/>
  {:else if name === 'chevron-left'}
    <path d="m15 5-7 7 7 7"/>
  {:else if name === 'sparkle'}
    <path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"/>
  {:else if name === 'sun'}
    <circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>
  {:else if name === 'moon'}
    <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z"/>
  {:else if name === 'menu'}
    <path d="M4 7h16M4 12h16M4 17h16"/>
  {:else if name === 'close'}
    <path d="M5 5 19 19M19 5 5 19"/>
  {:else if name === 'circle-check'}
    <circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>
  {:else if name === 'layers'}
    <path d="m12 2 9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5"/>
  {:else if name === 'wifi'}
    <path d="M2.5 8.5a15 15 0 0 1 19 0M5.5 12a10.5 10.5 0 0 1 13 0M8.5 15.5a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor" stroke="none"/>
  {:else if name === 'activity'}
    <path d="M2 12h4l3-7 5.5 14 3-7H22"/>
  {:else if name === 'more'}
    <circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>
  {:else if name === 'keyboard'}
    <rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h1M10 9h1M14 9h1M18 9h.1M6 12h1M10 12h1M14 12h1M18 12h.1M8 16h8"/>
  {/if}
</svg>
