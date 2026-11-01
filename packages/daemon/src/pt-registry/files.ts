/**
 * Read-only, explicitly scoped filesystem inventory for Pocket-T mobile.
 *
 * A remote browser never gets to choose an absolute directory. The Mac owner
 * preconfigures a JSON array of canonical folder roots in POCKET_T_FILE_ROOTS.
 * We expose file names/metadata only: no file content, writes, credential
 * files, uploads or downloads. Symlinks are listed but never followed.
 *
 * This is intentionally small and honest: work with the daemon's ordinary
 * macOS filesystem permissions. Respect TCC / MDM denials. Never request
 * elevated access, Full Disk Access, or a protected directory automatically.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

const MAX_ROOTS = 20;
const MAX_ITEMS = 200;
const MAX_PATH_LENGTH = 1600;
const MAX_ROOTS_ENV = 8192;

export interface FileRoot {
  id: string;
  label: string;
  // Absolute paths are never sent to the web client.
  readonly absolutePath: string;
}

export interface FileEntry {
  name: string;
  relativePath: string;
  kind: 'directory' | 'file' | 'symlink' | 'other';
  size: number | null;
  modifiedAt: number | null;
}

export interface DirectoryListing {
  rootId: string;
  relativePath: string;
  entries: FileEntry[];
  truncated: boolean;
}

/** Opt-in local Mac config. Invalid paths are simply unavailable. */
export function configuredFileRoots(raw: string | undefined = process.env.POCKET_T_FILE_ROOTS): FileRoot[] {
  if (!raw || raw.length > MAX_ROOTS_ENV) return [];
  let values: unknown;
  try { values = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(values)) return [];
  const roots: FileRoot[] = [];
  const seen = new Set<string>();
  for (const input of values) {
    if (typeof input !== 'string' || input.length > MAX_PATH_LENGTH) continue;
    const expanded = input === '~' ? os.homedir()
      : input.startsWith('~/') ? path.join(os.homedir(), input.slice(2))
      : input;
    if (!path.isAbsolute(expanded)) continue;
    try {
      const canonical = fs.realpathSync(expanded);
      if (!fs.statSync(canonical).isDirectory() || seen.has(canonical)) continue;
      seen.add(canonical);
      roots.push({
        id: createHash('sha256').update(canonical).digest('hex').slice(0, 16),
        label: path.basename(canonical) || 'Computer',
        absolutePath: canonical,
      });
    } catch { /* missing, TCC-blocked or inaccessible — not usable */ }
    if (roots.length >= MAX_ROOTS) break;
  }
  return roots;
}

function checkRelativePath(value: unknown): string[] {
  if (typeof value !== 'string' || value.length > MAX_PATH_LENGTH) {
    throw new Error('Invalid folder path');
  }
  if (value === '') return [];
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) {
    throw new Error('Only paths inside an approved folder are allowed');
  }
  const segments = value.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..' || s.includes('\0'))) {
    throw new Error('Invalid folder traversal');
  }
  return segments;
}

/** Returns an explicitly permitted directory, refusing symlink traversal. */
export function resolveAllowedDirectory(root: FileRoot, relativePath: unknown): string {
  const segments = checkRelativePath(relativePath);
  let current = root.absolutePath;
  for (const name of segments) {
    const candidate = path.join(current, name);
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) throw new Error('Symbolic-link traversal is not allowed');
    if (!stat.isDirectory()) throw new Error('Not a directory');
    current = candidate;
  }
  // Canonical check also catches racey or redirected intermediate segments.
  const canonical = fs.realpathSync(current);
  if (canonical !== root.absolutePath && !canonical.startsWith(root.absolutePath + path.sep)) {
    throw new Error('Folder is outside the approved root');
  }
  return canonical;
}

/** Metadata-only listing. Never read or transmit file bytes. */
export function listAllowedDirectory(root: FileRoot, relativePath: string, showHidden = false): DirectoryListing {
  const dir = resolveAllowedDirectory(root, relativePath);
  const visible = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => showHidden || !entry.name.startsWith('.'))
    .sort((a, b) => {
      const ad = a.isDirectory() ? 0 : 1;
      const bd = b.isDirectory() ? 0 : 1;
      return ad !== bd ? ad - bd : a.name.localeCompare(b.name);
    });
  const items = visible.slice(0, MAX_ITEMS);
  const entries: FileEntry[] = items.map((entry) => {
    const child = path.join(dir, entry.name);
    let stat: fs.Stats | null = null;
    try { stat = fs.lstatSync(child); } catch { /* directory changed */ }
    return {
      name: entry.name,
      relativePath: relativePath ? relativePath + '/' + entry.name : entry.name,
      kind: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      size: stat && stat.isFile() ? stat.size : null,
      modifiedAt: stat ? stat.mtimeMs : null,
    };
  });
  return { rootId: root.id, relativePath, entries, truncated: visible.length > MAX_ITEMS };
}

/** Server always looks up the root ID; a web request cannot inject a path. */
export function handleFileBrowse(rootId: unknown, relativePath: unknown): DirectoryListing {
  if (typeof rootId !== 'string' || !/^[0-9a-f]{16}$/.test(rootId)) {
    throw new Error('Unknown approved folder');
  }
  const root = configuredFileRoots().find((item) => item.id === rootId);
  if (!root) throw new Error('Folder is not approved or no longer available');
  if (typeof relativePath !== 'string') throw new Error('Invalid folder path');
  return listAllowedDirectory(root, relativePath);
}

export function publicFileRoots(): Array<Pick<FileRoot, 'id' | 'label'>> {
  return configuredFileRoots().map(({ id, label }) => ({ id, label }));
}
