import { useEffect, useRef } from 'react';
import type { Session } from '@pocket-t/shared';
import '@xterm/xterm/css/xterm.css';

interface Props {
  session:   Session;
  rawVts:    string[];      // base64 raw VT chunks in order
  onInput:   (text: string) => void;
}

export function TerminalView({ session, rawVts, onInput }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef      = useRef<any>(null);
  const addonRef     = useRef<any>(null);

  useEffect(() => {
    let term: any;
    let fitAddon: any;

    async function init() {
      const { Terminal }  = await import('@xterm/xterm');
      const { FitAddon }  = await import('@xterm/addon-fit');

      term = new Terminal({
        theme: {
          background:  '#0c0d0f',
          foreground:  'rgba(255,255,255,0.85)',
          cursor:      '#4ade80',
          black:       '#0c0d0f',
        },
        fontFamily:  'JetBrains Mono, Fira Code, monospace',
        fontSize:    13,
        lineHeight:  1.4,
        scrollback:  5000,
        convertEol:  true,
        disableStdin: true,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current!);
      fitAddon.fit();

      void onInput;

      termRef.current  = term;
      addonRef.current = fitAddon;

      // Replay existing rawVt chunks
      for (const b64 of rawVts) {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        term.write(bytes);
      }
      lastWrittenRef.current = rawVts.length;
    }

    init();

    const observer = new ResizeObserver(() => addonRef.current?.fit());
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      term?.dispose();
    };
  }, [session.id]);  // Re-init when session changes

  // Write new chunks as they arrive
  const lastWrittenRef = useRef(0);
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    for (let i = lastWrittenRef.current; i < rawVts.length; i++) {
      const bytes = Uint8Array.from(atob(rawVts[i]), (c) => c.charCodeAt(0));
      term.write(bytes);
    }
    lastWrittenRef.current = rawVts.length;
  }, [rawVts]);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 overflow-hidden bg-[#0c0d0f]"
      style={{ padding: '4px' }}
    />
  );
}
