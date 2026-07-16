import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PlatformTarget } from './publish-api.js';

const CONFIG_DIR = join(homedir(), '.boardsmith');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface GlobalConfig {
  /** API keys are per platform target — dev/test/prod are separate deployments
   * with separate key stores, so one saved key must never be sent to another
   * target. */
  apiKeys?: Partial<Record<PlatformTarget, string>>;
}

export function readGlobalConfig(): GlobalConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    return migrateLegacyApiKey(parsed);
  } catch {
    return {};
  }
}

/** One-time migration: the pre-taxonomy config stored a single `apiKey`,
 * which was only ever used for --test publishes. Move it to apiKeys.test and
 * rewrite the file so the legacy field disappears. */
function migrateLegacyApiKey(parsed: GlobalConfig & { apiKey?: string }): GlobalConfig {
  if (parsed.apiKey === undefined) return parsed;
  const { apiKey, ...rest } = parsed;
  const migrated: GlobalConfig = {
    ...rest,
    apiKeys: { test: apiKey, ...rest.apiKeys },
  };
  writeGlobalConfig(migrated);
  return migrated;
}

export function writeGlobalConfig(config: GlobalConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

export function getApiKey(target: PlatformTarget): string | undefined {
  return readGlobalConfig().apiKeys?.[target];
}

export function saveApiKey(target: PlatformTarget, apiKey: string): void {
  const config = readGlobalConfig();
  config.apiKeys = { ...config.apiKeys, [target]: apiKey };
  writeGlobalConfig(config);
}
