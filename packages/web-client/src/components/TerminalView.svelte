<script lang="ts">
  import { onMount } from 'svelte';
  import { setTermSink, requestResync, conn } from '../lib/store';

  interface Props {
    sessionId: string;
    fontSize?: number;
    interactive?: boolean;
  }

  let { sessionId, fontSize = 14, interactive = true }: Props = $props();
  let host: HTMLDivElement;
  let term: import('@xterm/xterm').Terminal | null = null;
  let fit: import('@xterm/addon-fit').FitAddon | null = null;
  let ro: ResizeObserver | null = null;
  let disposed = false;
  let loading = $state(true);

  function fitToScreen(): void {
    if (!term || !fit) return;
    try {
      if (!host || host.clientWidth < 30 || host.clientHeight < 30) return;
      fit.fit();
      // The live PTY is shared by other clients. Only resize when a real
      // user is controlling this session, never during a hidden mount.
      if (interactive && term.cols >= 4 && term.rows >= 2) {
        conn.sendResize(term.cols, term.rows);
      }
    } catch { /* temporarily hidden or sizing between viewport changes */ }
  }

  $effect(() => {
    const size = Math.min(22, Math.max(11, fontSize));
    if (term) {
      term.options.fontSize = size;
      requestAnimationFrame(fitToScreen);
    }
  });

  export function focusTerminal(): void {
    term?.focus();
  }

  export async function copySelection(): Promise<boolean> {
    const selected = term?.getSelection() ?? '';
    if (!selected) return false;
    try {
      await navigator.clipboard.writeText(selected);
      return true;
    } catch {
      return false;
    }
  }

  export function clearLocalScreen(): void {
    // This only clears the browser's visual buffer — it does NOT send a
    // command to the remote shell or erase any remote session history.
    term?.clear();
  }

  onMount(() => {
    let dataSubscription: { dispose(): void } | null = null;
    let focusSubscription: { dispose(): void } | null = null;

    const init = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/xterm/css/xterm.css'),
      ]);
      if (disposed) return;
      term = new Terminal({
        cursorBlink: true,
        fontSize,
        fontFamily: "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
        letterSpacing: 0,
        lineHeight: 1.2,
        scrollback: 10000,
        allowTransparency: false,
        cursorStyle: 'bar',
        convertEol: false,
        theme: {
          background: '#0b1019',
          foreground: '#dfe9ef',
          cursor: '#9ef1d3',
          selectionBackground: '#38695d',
          black: '#172130',
          red: '#f28d92',
          green: '#a0e6bb',
          yellow: '#f6ce86',
          blue: '#92baff',
          magenta: '#d6b3ef',
          cyan: '#87e9e9',
          white: '#e6eef3',
          brightBlack: '#7c95a2',
          brightRed: '#ffa8ab',
          brightGreen: '#c4f6d8',
          brightYellow: '#f6e4ad',
          brightBlue: '#b6d3ff',
          brightMagenta: '#ecc9f5',
          brightCyan: '#bbfaf4',
          brightWhite: '#ffffff',
        },
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);

      // Real PTY input, not an AI prompt. When disconnected or detached,
      // the caller refuses input rather than saving surprise commands.
      dataSubscription = term.onData((data) => {
        if (interactive) conn.sendInput(data);
      });

      // Uint8Array is passed directly to xterm; it owns UTF-8 and ANSI
      // streaming boundaries. A non-streaming TextDecoder would corrupt
      // split multibyte terminal output.
      setTermSink({
        write: (bytes) => term?.write(bytes),
        snapshot: (text) => {
          term?.reset();
          term?.write(text);
        },
      });
      loading = false;

      // The initial attach may predate the lazy xterm module load. Ask
      // the daemon to replay its actual VT state for this live session.
      requestResync();
      fitToScreen();
      ro = new ResizeObserver(() => fitToScreen());
      ro.observe(host);
      focusSubscription = term.onResize(() => fitToScreen());
    };

    void init().catch(() => { loading = false; });

    return () => {
      disposed = true;
      setTermSink(null);
      dataSubscription?.dispose();
      focusSubscription?.dispose();
      ro?.disconnect();
      term?.dispose();
      term = null;
      fit = null;
    };
  });
</script>

<div class="terminal-wrap" class:readonly={!interactive}>
  {#if loading}<div class="loading">Connecting to live terminal…</div>{/if}
  <div class="terminal-host" bind:this={host} aria-label="Interactive remote terminal for {sessionId}"></div>
</div>

<style>
  .terminal-wrap{position:relative;flex:1;min-height:0;min-width:0;overflow:hidden;background:#0b1019}
  .terminal-host{position:absolute;inset:0;padding:14px 14px 8px;width:100%;height:100%;overflow:hidden}
  .loading{position:absolute;inset:0;z-index:1;background:#0b1019;display:grid;place-items:center;color:#93aeb6;font-size:12px}
  .readonly{opacity:.84}
  :global(.xterm){height:100%;outline:none}
  :global(.xterm-viewport){-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:#344b53 transparent}
  :global(.xterm-screen){margin:0}
  @media(max-width:760px){.terminal-host{padding:13px 10px 7px}}
</style>
