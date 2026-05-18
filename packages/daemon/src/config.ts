import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
// keytar is a native CommonJS addon. The esbuild bundle marks it external
// and the build banner provides a `require` shim, so load it via require()
// rather than a named ESM import (which Node can't do from a native CJS addon).
declare const require: NodeJS.Require;
const { setPassword, getPassword, deletePassword } =
  require('keytar') as typeof import('keytar');

const KEYCHAIN_SERVICE = 'app.pocket-t';
const KEYCHAIN_ACCOUNT = 'daemon-jwt';

const CONFIG_DIR  = join(os.homedir(), '.pocket-t');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface DaemonConfig {
  daemonId:  string;
  accountId: string;
  token:     string;
  relayUrl:  string;
  e2eEnabled: boolean;  // default false for self-hosted, true for cloud
}

// Non-secret fields persisted to disk
interface ConfigFile {
  daemonId:  string;
  accountId: string;
  relayUrl:  string;
  e2eEnabled: boolean;
}

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

export async function loadConfig(): Promise<DaemonConfig> {
  if (!existsSync(CONFIG_FILE)) {
    console.error(
      '[pocket-t] Not authenticated. Run: pocket-t auth <one-time-token>\n' +
      '[pocket-t] Get your token at https://app.pocket-t.ai/dashboard'
    );
    process.exit(1);
  }

  const file: ConfigFile = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));

  const token = await getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
  if (!token) {
    console.error(
      '[pocket-t] Daemon credential missing from Keychain.\n' +
      '[pocket-t] Re-authenticate: pocket-t auth <one-time-token>'
    );
    process.exit(1);
  }

  return { ...file, token, e2eEnabled: file.e2eEnabled ?? false };
}

export async function saveConfig(cfg: DaemonConfig): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Non-secret fields → disk (readable, not sensitive)
  const fileData: ConfigFile = {
    daemonId:  cfg.daemonId,
    accountId: cfg.accountId,
    relayUrl:  cfg.relayUrl,
    e2eEnabled: cfg.e2eEnabled,
  };
  writeFileSync(CONFIG_FILE, JSON.stringify(fileData, null, 2));

  // JWT → macOS Keychain (never on disk)
  await setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, cfg.token);
  console.log('[pocket-t] Credential stored in Keychain ✓');
}

export async function deleteConfig(): Promise<void> {
  await deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).catch(() => {});
  // Leave the config file — daemonId is still useful for audit
}
