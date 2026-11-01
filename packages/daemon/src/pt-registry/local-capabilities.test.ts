import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  configuredFileRoots,
  listAllowedDirectory,
  resolveAllowedDirectory,
} from './files.js';
import { approvedApps, launchApprovedApp } from './apps.js';

describe('scoped Mac filesystem inventory', () => {
  it('defaults to no file access until the Mac owner configures roots', () => {
    expect(configuredFileRoots('')).toEqual([]);
    expect(configuredFileRoots('oops')).toEqual([]);
  });

  it('lists metadata inside approved roots without file contents', () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-t-files-'));
    try {
      fs.mkdirSync(path.join(rootPath, 'src'));
      fs.writeFileSync(path.join(rootPath, 'notes.txt'), 'password=top-secret');
      fs.writeFileSync(path.join(rootPath, '.env'), 'TOKEN=hide-me');
      const roots = configuredFileRoots(JSON.stringify([rootPath]));
      expect(roots).toHaveLength(1);
      const listing = listAllowedDirectory(roots[0]!, '');
      expect(listing.entries.map((entry) => entry.name)).toEqual(['src', 'notes.txt']);
      expect(JSON.stringify(listing)).not.toContain('top-secret');
      expect(JSON.stringify(listing)).not.toContain('TOKEN=hide-me');
      expect(listing.entries[1]?.kind).toBe('file');
      expect(listing.entries[1]?.size).toBeGreaterThan(0);
    } finally {
      fs.rmSync(rootPath, { recursive: true, force: true });
    }
  });

  it('refuses parent paths, absolute paths and symbolic link escapes', () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-t-scope-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-t-outside-'));
    try {
      fs.mkdirSync(path.join(rootPath, 'inside'));
      fs.symlinkSync(outside, path.join(rootPath, 'outside'));
      const root = configuredFileRoots(JSON.stringify([rootPath]))[0]!;
      expect(resolveAllowedDirectory(root, 'inside')).toBe(path.join(rootPath, 'inside'));
      for (const bad of ['..', '../outside', '/etc', './inside', 'inside/../', 'inside//other']) {
        expect(() => resolveAllowedDirectory(root, bad)).toThrow();
      }
      expect(() => resolveAllowedDirectory(root, 'outside')).toThrow(/Symbolic-link/);
    } finally {
      fs.rmSync(rootPath, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('local approval of applications', () => {
  it('requires exact locally-allowlisted bundle identifiers', () => {
    expect(approvedApps()).toEqual([]); // CI has no app launch allowlist
    expect(approvedApps(JSON.stringify([
      { name: 'Safari', bundleId: 'com.apple.Safari' },
      { name: 'Safari Again', bundleId: 'com.apple.Safari' },
      { name: 'Invalid', bundleId: 'com.apple.Safari;rm -rf ~' },
      { name: 'Terminal', bundleId: 'com.apple.Terminal' },
    ]))).toEqual([
      { name: 'Safari', bundleId: 'com.apple.Safari' },
      { name: 'Terminal', bundleId: 'com.apple.Terminal' },
    ]);
  });

  it('does not launch apps on non-macOS CI or without a local allowlist', async () => {
    if (process.platform !== 'darwin') {
      await expect(launchApprovedApp('com.apple.Safari')).rejects.toThrow('macOS');
    }
  });
});
