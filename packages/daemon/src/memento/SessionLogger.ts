import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { TaggedEvent } from './EventTagger.js';

export class SessionLogger {
  private sessionFile: string;

  constructor(projectRoot: string, sessionId: string) {
    const dir = join(projectRoot, '.nohup', 'sessions');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.sessionFile = join(dir, `${sessionId}.jsonl`);
  }

  log(event: TaggedEvent): void {
    try {
      appendFileSync(this.sessionFile, JSON.stringify(event) + '\n', 'utf-8');
    } catch (err) { console.error('[memento] SessionLogger write failed:', err); }
  }

  get path(): string { return this.sessionFile; }
}
