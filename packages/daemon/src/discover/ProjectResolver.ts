import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';

export interface ProjectConfig {
  id:          string;   // stable project ID
  name:        string;   // display name
  root:        string;   // absolute path
  mementoEnabled: boolean;
}

// Walk up from cwd until we find .nohup-project or reach home/root
export function resolveProject(cwd: string): ProjectConfig | null {
  const home = os.homedir();
  let dir    = cwd;

  while (dir !== dirname(dir)) {  // stop at filesystem root
    const dotfile = join(dir, '.nohup-project');
    if (existsSync(dotfile)) {
      try {
        const cfg = JSON.parse(readFileSync(dotfile, 'utf-8'));
        return { ...cfg, root: dir };
      } catch {
        // Malformed dotfile — treat as no project
        return null;
      }
    }
    // Also stop at home directory — don't walk above it
    if (dir === home) break;
    dir = dirname(dir);
  }

  return null;
}

// Initialize a project in the current directory
export function initProject(cwd: string, name?: string): ProjectConfig {
  const existing = resolveProject(cwd);
  if (existing) return existing;

  const id     = randomProjectId();
  const pName  = name ?? cwd.split('/').pop() ?? 'project';
  const config: Omit<ProjectConfig, 'root'> = {
    id,
    name:           pName,
    mementoEnabled: true,
  };

  const dotfile = join(cwd, '.nohup-project');
  writeFileSync(dotfile, JSON.stringify(config, null, 2));

  // Create .nohup directory structure
  mkdirSync(join(cwd, '.nohup', 'sessions'), { recursive: true });
  mkdirSync(join(cwd, '.nohup', 'brain'),    { recursive: true });

  console.log(`[pocket-t] Project initialized: ${pName} (${id})`);
  return { ...config, root: cwd };
}

function randomProjectId(): string {
  return Math.random().toString(36).slice(2, 10);
}
