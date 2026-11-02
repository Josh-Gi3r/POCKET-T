<script lang="ts">
  /**
   * Pocket-T's single icon vocabulary. Stroke-based vector symbols make
   * hover, active and selected states consistent across all workspaces.
   * Drawn as paths; never display emoji as primary interface controls.
   */
  let {
    name,
    size = 20,
    stroke = 1.8,
  }: {
    name: string;
    size?: number;
    stroke?: number;
  } = $props();

  const icons: Record<string, string> = {
    home: 'm3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 21v-7h6v7',
    terminal: 'm4 6 6 6-6 6 M12 18h8',
    folder: 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    laptop: 'M4 4h16v12H4z M2 20h20 M9 20l1-4m4 4-1-4',
    window: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M3 9h18 M7 6.5h.01 M10 6.5h.01',
    apps: 'M3 3h8v8H3z M13 3h8v8h-8z M3 13h8v8H3z M13 13h8v8h-8z',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
    settings: 'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M18.4 5.6l-2.1 2.1 M7.7 16.3l-2.1 2.1 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    arrowRight: 'M4 12h16 M13 5l7 7-7 7',
    arrowUp: 'M12 20V4 M5 11l7-7 7 7',
    arrowUpRight: 'M5 19 19 5 M8 5h11v11',
    arrowLeft: 'M20 12H4 M11 19l-7-7 7-7',
    chevronDown: 'm6 9 6 6 6-6',
    chevronRight: 'm9 18 6-6-6-6',
    chevronLeft: 'm15 18-6-6 6-6',
    chevronUp: 'm6 15 6-6 6 6',
    plus: 'M12 5v14 M5 12h14',
    minus: 'M5 12h14',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z m6-2 4 4',
    copy: 'M8 8h12v12H8z M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4',
    expand: 'M8 3H3v5 M3 3l7 7 M16 3h5v5 M21 3l-7 7 M3 16v5h5 M3 21l7-7 M21 16v5h-5 M21 21l-7-7',
    shrink: 'M10 10H4V4 M4 4l6 6 M14 10h6V4 M20 4l-6 6 M10 14H4v6 M4 20l6-6 M14 14h6v6 M20 20l-6-6',
    keyboard: 'M3 5h18v14H3z M7 9h.01 M11 9h.01 M15 9h.01 M19 9h.01 M7 12h.01 M11 12h.01 M15 12h.01 M19 12h.01 M7 15h10',
    check: 'M4 12l5 5L20 6',
    checkCircle: 'M21 11.1V12a9 9 0 1 1-5.1-8.1 M8 12l3 3 9-9',
    refresh: 'M20 11a8 8 0 1 0-2.2 5.6 M20 4v7h-7',
    list: 'M9 6h12 M9 12h12 M9 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
    activity: 'M2 12h5l3-8 4 16 3-8h5',
    layers: 'm12 2 9 5-9 5-9-5z M3 12l9 5 9-5 M3 17l9 5 9-5',
    sparkles: 'm12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z M19 18l.6 1.4L21 20l-1.4.6L19 22l-.6-1.4L17 20l1.4-.6z',
    compass: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z m3.4-13.4-2.1 4.7-4.7 2.1 2.1-4.7z',
    moon: 'M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8z',
    sun: 'M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6 7 7 M17 17l1.4 1.4 M18.4 5.6 17 7 M7 17l-1.4 1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
    sliders: 'M4 7h16 M4 17h16 M9 4v6 M15 14v6',
    x: 'M5 5l14 14 M19 5 5 19',
    menu: 'M4 6h16 M4 12h16 M4 18h16',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
    command: 'M7 9a2.5 2.5 0 1 1 2.5-2.5V17A2.5 2.5 0 1 1 7 14.5h10a2.5 2.5 0 1 1-2.5 2.5V7A2.5 2.5 0 1 1 17 9z',
    scan: 'M4 9V5a1 1 0 0 1 1-1h4 M15 4h4a1 1 0 0 1 1 1v4 M20 15v4a1 1 0 0 1-1 1h-4 M9 20H5a1 1 0 0 1-1-1v-4',
    bolt: 'm13 2-9 11h7l-1 9 10-12h-7z',
    dots: 'M5 12h.01 M12 12h.01 M19 12h.01',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    volume: 'M4 9h4l5-4v14l-5-4H4z M17 9a5 5 0 0 1 0 6',
    play: 'm7 4 13 8-13 8z',
    pause: 'M8 5v14 M16 5v14',
    file: 'M5 2h9l5 5v15H5z M14 2v5h5 M8 12h8 M8 16h8',
    link: 'M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.2 1.2 M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.2-1.2',
    history: 'M3 3v6h6 M4.5 9a8 8 0 1 1 0 6 M12 7v5l3 2',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 10v7 M12 7h.01',
    cursor: 'm5 2 14 10-7 1-3 7z',
    send: 'm22 2-7 20-4-9-9-4z M22 2 11 13',
  };
</script>

<svg
  width={size} height={size} viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width={stroke}
  stroke-linecap="round" stroke-linejoin="round"
  aria-hidden="true" focusable="false"
><path d={icons[name] ?? icons.info}/></svg>