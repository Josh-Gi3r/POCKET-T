// Production prompt detection — port of oly's prompt_detector.rs heuristics.
// Detects when a CLI is waiting for user input vs. producing output.

import type { ApprovalOption } from '@pocket-t/shared';

export interface PromptDetection {
  isPrompt:  boolean;
  options?:  ApprovalOption[];
  promptType?: 'approval' | 'input' | 'confirm' | 'select';
}

// ── Heuristics (order matters: most specific first) ───────────────────────

const APPROVAL_PATTERNS: Array<{
  pattern: RegExp;
  extract: (match: RegExpMatchArray, text: string) => ApprovalOption[];
}> = [
  // Claude Code numbered select
  {
    pattern: /❯?\s*(\d+)\.\s+(.+?)(?:\n\s*\d+\.|$)/gm,
    extract: (_, text) => {
      const options: ApprovalOption[] = [];
      let m: RegExpExecArray | null;
      const re = /(\d+)\.\s+(.+)/g;
      while ((m = re.exec(text)) !== null && options.length < 6) {
        const label = m[2].trim().replace(/\s+/g, ' ').slice(0, 80);
        const isYes = /^(yes|allow|approve|continue|ok|accept|proceed)/i.test(label);
        const isNo  = /^(no|deny|reject|cancel|stop|abort|skip)/i.test(label);
        options.push({
          key:     m[1] + '\r',
          label,
          variant: isYes ? 'primary' : isNo ? 'danger' : 'secondary',
        });
      }
      return options;
    },
  },
  // Standard y/n
  {
    pattern: /\[([Yy])\/([Nn])\]\s*[?:]?\s*$/m,
    extract: (match) => {
      const yesDefault = match[1] === 'Y';
      return [
        { key: 'y\r', label: yesDefault ? 'Yes (default)' : 'Yes', variant: 'primary'   },
        { key: 'n\r', label: yesDefault ? 'No' : 'No (default)',   variant: 'danger'    },
      ];
    },
  },
  // yes/no/quit
  {
    pattern: /\(yes\/no\/quit\)/i,
    extract: () => [
      { key: 'yes\r',  label: 'Yes',  variant: 'primary'   },
      { key: 'no\r',   label: 'No',   variant: 'danger'    },
      { key: 'quit\r', label: 'Quit', variant: 'secondary' },
    ],
  },
  // Press any key / Press Enter
  {
    pattern: /press\s+(any\s+key|enter|return)\s+to\s+continue/i,
    extract: () => [
      { key: '\r', label: 'Continue', variant: 'primary' },
    ],
  },
  // Inquirer.js / Prompts select prompt
  {
    pattern: /\?\s+.+\s+›\s*$/m,
    extract: () => [
      { key: '\r',     label: 'Confirm (Enter)',   variant: 'primary'   },
      { key: '\x03',   label: 'Cancel (Ctrl+C)',   variant: 'danger'    },
    ],
  },
];

// Input prompts — not approvals, but signal waiting for input
const INPUT_PROMPT_PATTERNS = [
  /Enter\s+[\w\s]+\s*:\s*$/im,
  /[\w\s]+\s*>\s*$/m,      // shell-style prompt
  /Password\s*:\s*$/im,
  /Username\s*:\s*$/im,
  /\$\s*$/m,               // bare shell prompt
];

// Definite non-prompts — these are output lines, not prompts
const NOT_PROMPT_PATTERNS = [
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,  // timestamp in output
  /^\s*at\s+\w+\s+\(/m,                    // stack trace
  /^(info|warn|error|debug)\s*:/im,         // log lines
  /\d+%/,                                   // progress percentage
];

// Trailing content heuristics — a prompt usually ends with
// cursor position or trailing whitespace after the question
const CURSOR_HEURISTICS = [
  /[?:>]\s*$/,     // ends with ? : >
  /\[\s*\]\s*$/,   // ends with empty brackets [ ]
  /\(\s*\)\s*$/,   // ends with empty parens ( )
];

export function detectPrompt(text: string): PromptDetection {
  // Fast reject: if it looks like log output, skip
  if (NOT_PROMPT_PATTERNS.some((p) => p.test(text))) {
    return { isPrompt: false };
  }

  // Check for approval patterns (most valuable detections)
  for (const { pattern, extract } of APPROVAL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const options = extract(match, text);
      if (options.length > 0) {
        return {
          isPrompt:   true,
          promptType: 'approval',
          options,
        };
      }
    }
  }

  // Check for input prompts
  if (INPUT_PROMPT_PATTERNS.some((p) => p.test(text))) {
    return {
      isPrompt:   true,
      promptType: 'input',
      options: [
        { key: '\r', label: 'Send (Enter)', variant: 'primary' },
      ],
    };
  }

  // Cursor heuristics — text ends in a way that suggests waiting
  const lastLine = text.trimEnd().split('\n').pop() ?? '';
  if (
    lastLine.length > 0 &&
    lastLine.length < 120 &&
    CURSOR_HEURISTICS.some((p) => p.test(lastLine))
  ) {
    return {
      isPrompt:   true,
      promptType: 'input',
      options: [
        { key: '\r', label: 'Send (Enter)', variant: 'primary' },
      ],
    };
  }

  return { isPrompt: false };
}

// Quiescence detector — tracks output velocity.
// An agent session that suddenly goes quiet after active output
// has likely reached a decision point.
export class QuiescenceDetector {
  private lastOutputAt  = Date.now();
  private outputInWindow = 0;
  private windowMs      = 1000;
  private windowTimer?: NodeJS.Timeout;

  onOutput(bytes: number) {
    this.lastOutputAt   = Date.now();
    this.outputInWindow += bytes;

    clearTimeout(this.windowTimer);
    this.windowTimer = setTimeout(
      () => { this.outputInWindow = 0; },
      this.windowMs,
    );
  }

  // Returns true if output has gone quiet for >quiesceMs after activity
  isQuiescent(quiesceMs: number): boolean {
    return (
      this.outputInWindow === 0 &&
      Date.now() - this.lastOutputAt > quiesceMs
    );
  }

  silenceMs(): number {
    return Date.now() - this.lastOutputAt;
  }
}
