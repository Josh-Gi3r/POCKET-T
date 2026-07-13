// GenericAgentAdapter — fallback used when we can recognise a vendor
// CLI by name (OpenClaw, Hermes, NanoClaw, …) but we don't yet have
// a specific parser for its output format.
//
// What it does:
//   - Tags the session with the vendor (sidebar badge, cost meter
//     can apply per-vendor pricing once we know the model in use).
//   - Emits a single onboarding "detected" event so the Bubble view
//     doesn't show an empty waiting-state and the user understands
//     why bubbles aren't appearing.
//   - The Terminal view continues to render every byte exactly as
//     before — this adapter never gets in the way of the raw stream.
//
// When a real parser for that vendor is written, drop a
// <Vendor>Adapter.ts next to this file and update detect.ts to
// return it instead. This adapter is a safety net, not a stub that
// blocks anyone — every existing feature still works.

import { EventEmitter } from 'node:events';
import type { Adapter } from './Adapter.js';

export class GenericAgentAdapter extends EventEmitter implements Adapter {
  readonly vendor: string;

  constructor(vendor: string) {
    super();
    this.vendor = vendor;
  }

  start(): boolean {
    // Defer so any 'event' listener attached after construction still fires.
    setImmediate(() => {
      this.emit('event', {
        kind:      'chat',
        role:      'assistant',
        text:      `[${this.vendor} session detected. A vendor-specific bubble adapter for ${this.vendor} hasn't been written yet — the Terminal view continues to work normally. To contribute one, add ${capitalise(this.vendor)}Adapter.ts implementing the Adapter interface (see ClaudeAdapter.ts for the pattern).]`,
        timestamp: Date.now(),
      });
    });
    return true;
  }

  stop(): void { /* no resources to release */ }
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
