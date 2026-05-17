import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// CLI tools worth surfacing to the user
const INTERESTING = new Set([
  'claude', 'codex', 'aider', 'gemini', 'cursor',
  'node', 'python', 'python3', 'ruby', 'go', 'cargo', 'bun', 'deno',
  'npm', 'pnpm', 'yarn', 'npx', 'tsx', 'ts-node',
  'terraform', 'kubectl', 'docker', 'ssh',
  'pytest', 'jest', 'vitest', 'mocha',
]);

export interface DiscoveredProcess {
  pid:         number;
  ppid:        number;
  cmd:         string;
  args:        string;
  tty:         string;
  user:        string;
  interesting: boolean;
}

export async function scanProcesses(): Promise<DiscoveredProcess[]> {
  try {
    const { stdout } = await exec('ps', [
      '-axo', 'pid,ppid,tty,user,comm,args',
    ]);

    return stdout
      .split('\n')
      .slice(1)
      .filter(Boolean)
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        const pid   = Number(parts[0]);
        const ppid  = Number(parts[1]);
        const tty   = parts[2];
        const user  = parts[3];
        const comm  = parts[4];
        const args  = parts.slice(5).join(' ');
        const cmd   = comm.split('/').pop() ?? comm;

        return {
          pid, ppid, tty, user, cmd, args,
          interesting: INTERESTING.has(cmd.toLowerCase()),
        };
      })
      .filter((p) => !isNaN(p.pid) && p.pid > 1 && p.tty !== '??');
  } catch {
    return [];
  }
}
