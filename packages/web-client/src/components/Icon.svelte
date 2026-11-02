<script lang="ts">
  type Name = 'home'|'terminal'|'folder'|'apps'|'machine'|'vault'|'sparkle'|'chevron'|'arrow'|'arrow-left'|'plus'|'search'|'activity'|'command'|'grid'|'menu'|'close'|'wifi'|'refresh'|'clock'|'monitor'|'check'|'play'|'copy'|'keyboard'|'more'|'expand'|'layers'|'settings'|'scan'|'lock'|'circle';
  let { name, size = 20, stroke = 1.8 }: { name: Name; size?: number; stroke?: number } = $props();
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
{#if name === 'home'}
  <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-8h6v8"/>
{:else if name === 'terminal'}
  <rect x="2.8" y="3.5" width="18.4" height="17" rx="3"/><path d="m7 9 3 3-3 3m6.5 0h3"/>
{:else if name === 'folder'}
  <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2.1 2.2h6.4A2.5 2.5 0 0 1 21 9.7v9A2.3 2.3 0 0 1 18.7 21H5.3A2.3 2.3 0 0 1 3 18.7z"/>
{:else if name === 'apps'}
  <rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>
{:else if name === 'machine'}
  <rect x="2.8" y="3.5" width="18.4" height="13.5" rx="2.5"/><path d="M8 21h8m-4-4v4"/>
{:else if name === 'vault'}
  <rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>
{:else if name === 'sparkle'}
  <path d="m12 2 1.9 7.1L21 11l-7.1 1.9L12 20l-1.9-7.1L3 11l7.1-1.9zm7.5 16.5.6 2 .6-2 2-.6-2-.6-.6-2-.6 2-2 .6z"/>
{:else if name === 'chevron'}
  <path d="m9 5 7 7-7 7"/>
{:else if name === 'arrow'}
  <path d="M6 18 18 6M8 6h10v10"/>
{:else if name === 'arrow-left'}
  <path d="m12 19-7-7 7-7M5 12h14"/>
{:else if name === 'plus'}
  <path d="M12 5v14M5 12h14"/>
{:else if name === 'search'}
  <circle cx="11" cy="11" r="7"/><path d="m16.2 16.2 4.1 4.1"/>
{:else if name === 'activity'}
  <path d="M2 12h4l3-7 5 14 3-7h5"/>
{:else if name === 'command'}
  <path d="M9 7V5a3 3 0 1 0-3 3h2m7 0h3a3 3 0 1 0-3-3zm-7 8H5a3 3 0 1 0 3 3v-2m7-1v3a3 3 0 1 0 3-3h-2M8 8h8v8H8z"/>
{:else if name === 'grid'}
  <rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>
{:else if name === 'menu'}
  <path d="M4 7h16M4 12h16M4 17h16"/>
{:else if name === 'close'}
  <path d="M5 5 19 19M19 5 5 19"/>
{:else if name === 'wifi'}
  <path d="M2.5 8.5a15.8 15.8 0 0 1 19 0M5.5 12a10.5 10.5 0 0 1 13 0m-10 3.5a5.5 5.5 0 0 1 7 0M12 20h.01"/>
{:else if name === 'refresh'}
  <path d="M20 11a8 8 0 0 0-14.4-4.8L3.5 9M3.5 5.5V9H7m-3 4a8 8 0 0 0 14.4 4.8L20.5 15m0 3.5V15H17"/>
{:else if name === 'clock'}
  <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>
{:else if name === 'monitor'}
  <rect x="3" y="4" width="18" height="14" rx="2"/><path d="M9 22h6m-3-4v4"/>
{:else if name === 'check'}
  <path d="m5 12 4.5 4.5L19 7"/>
{:else if name === 'play'}
  <path d="m8 5 11 7-11 7z"/>
{:else if name === 'copy'}
  <rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>
{:else if name === 'keyboard'}
  <rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8"/>
{:else if name === 'more'}
  <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
{:else if name === 'expand'}
  <path d="M8 3H3v5m0-5 7 7m6 11h5v-5m0 5-7-7"/>
{:else if name === 'layers'}
  <path d="m12 3 9 5-9 5-9-5zm-9 9 9 5 9-5m-18 5 9 5 9-5"/>
{:else if name === 'settings'}
  <circle cx="12" cy="12" r="3"/><path d="M10 2h4l.5 3 2 1 2.5-1.5 2 3.5-2 2v2l2 2-2 3.5-2.5-1.5-2 1-.5 3h-4l-.5-3-2-1L5 18.5 3 15l2-2v-2L3 9l2-3.5L7.5 7l2-1z"/>
{:else if name === 'scan'}
  <path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3m13 5h3a2 2 0 0 0 2-2v-3M4 12h16"/>
{:else if name === 'lock'}
  <rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>
{:else if name === 'circle'}
  <circle cx="12" cy="12" r="9"/>
{/if}
</svg>
