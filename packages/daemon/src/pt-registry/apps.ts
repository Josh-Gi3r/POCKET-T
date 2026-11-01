/**
 * App launch is an explicit, scoped capability. The Mac owner must approve
 * application bundle IDs via POCKET_T_ALLOWED_APPS on the machine.
 *
 * App launch is not desktop automation: no window reading, keyboard access,
 * password entry, restriction bypass or browser tab control is implemented.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)+$/;
const MAX_APPS = 32;

export interface ApprovedApp {
  name: string;
  bundleId: string;
}

export function approvedApps(raw: string | undefined = process.env.POCKET_T_ALLOWED_APPS): ApprovedApp[] {
  if (!raw || raw.length > 8192) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const apps: ApprovedApp[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const { name, bundleId } = item as Record<string, unknown>;
    if (typeof name !== 'string' || name.length < 1 || name.length > 60) continue;
    if (typeof bundleId !== 'string' || bundleId.length > 180 || !BUNDLE_ID.test(bundleId)) continue;
    if (seen.has(bundleId)) continue;
    seen.add(bundleId);
    apps.push({ name, bundleId });
    if (apps.length >= MAX_APPS) break;
  }
  return apps;
}

export async function launchApprovedApp(bundleId: unknown): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('App launch is only supported on macOS');
  if (typeof bundleId !== 'string') throw new Error('Invalid application');
  const allowed = approvedApps().find((app) => app.bundleId === bundleId);
  if (!allowed) throw new Error('Application is not approved for remote launch');
  // argv only: no shell, shell interpolation, or remote launch of executables.
  await execFile('/usr/bin/open', ['-b', allowed.bundleId], {
    timeout: 8000,
    maxBuffer: 4096,
    windowsHide: true,
  });
}
