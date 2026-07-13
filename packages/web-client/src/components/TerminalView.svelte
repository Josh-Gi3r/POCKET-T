<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { setTermSink, requestResync, conn } from '../lib/store';

  let { sessionId }: { sessionId: string } = $props();

  let host = $state<HTMLDivElement | null>(null);
  // Loaded dynamically so @xterm/xterm is code-split out of the main bundle
  // and only fetched when this secondary tab is opened.
  let term: import('@xterm/xterm').Terminal | null = null;
  let fit: import('@xterm/addon-fit').FitAddon | null = null;
  let ro: ResizeObserver | null = null;
  const dec = new TextDecoder();

  function doFit() {
    if (!fit || !term) return;
    try {
      fit.fit();
      conn.sendResize(term.cols, term.rows);
    } catch {
      /* container briefly 0-sized during transitions */
    }
  }

  onMount(async () => {
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/xterm/css/xterm.css'),
    ]);
    term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: { background: '#0b0f14', foreground: '#e6edf3', cursor: '#3fe08f' },
      scrollback: 4000,
      convertEol: false,
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    if (host) term.open(host);
    doFit();

    // Typed keystrokes → PTY.
    term.onData((d) => conn.sendInput(d));

    // Register as the live sink for STDOUT / SNAPSHOT_VT of the current session.
    setTermSink({
      write: (bytes: Uint8Array) => term?.write(dec.decode(bytes)),
      snapshot: (text: string) => {
        term?.reset();
        term?.write(text);
      },
    });

    // We mounted after the attach-time snapshot was already sent (and
    // dropped, since no sink existed). Ask the daemon to resend it.
    requestResync();

    ro = new ResizeObserver(() => doFit());
    if (host) ro.observe(host);
  });

  onDestroy(() => {
    setTermSink(null);
    ro?.disconnect();
    term?.dispose();
    term = null;
  });
</script>

<div class="term-host" bind:this={host}></div>

<style>
  .term-host {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 6px calc(var(--safe-right) + 6px) 6px calc(var(--safe-left) + 6px);
    background: #0b0f14;
  }
  :global(.xterm) {
    height: 100%;
  }
  :global(.xterm-viewport) {
    -webkit-overflow-scrolling: touch;
  }
</style>
