// Primary: ghostty-opentui (full VT emulator)
let ptyToText: ((input: string, opts: { cols: number }) => string) | null = null;

try {
  const mod = await import('ghostty-opentui');
  ptyToText = mod.ptyToText;
  // stderr, not stdout — stdout is reserved for the MCP protocol
  console.error('[ansi] using ghostty-opentui (full VT emulator)');
} catch {
  console.error('[ansi] ghostty-opentui unavailable, using regex fallback');
}

// Fallback: regex strip
function regexStrip(raw: string): string {
  return raw
    // SGR color/style codes
    .replace(/\x1b\[[0-9;]*m/g, '')
    // Cursor movement: A B C D E F G H J K S T
    .replace(/\x1b\[[0-9;]*[ABCDEFGHJKSTfisu]/g, '')
    // OSC sequences (title sets, hyperlinks)
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
    // Character set switching
    .replace(/\x1b[()][AB012]/g, '')
    // Bare carriage returns (spinner frames write \r to go to col 0)
    .replace(/\r(?!\n)/g, '')
    // Null bytes
    .replace(/\x00/g, '')
    // Other escape sequences
    .replace(/\x1b[^[\]()]/g, '');
}

export function normalizeChunk(raw: string, cols: number = 120): string {
  if (!raw) return '';
  try {
    if (ptyToText) return ptyToText(raw, { cols });
  } catch (e) {
    console.warn('[ansi] ptyToText threw, using fallback:', e);
  }
  return regexStrip(raw);
}

// ─── Approval / Prompt Detection ──────────────────────────────────────────
// V3: production heuristic detector (port of oly's prompt_detector.rs).
export { detectPrompt as detectApproval } from './PromptDetector.js';
export type { PromptDetection as ApprovalDetection } from './PromptDetector.js';
