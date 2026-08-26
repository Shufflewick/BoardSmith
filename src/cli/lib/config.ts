import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PlatformTarget } from './publish-api.js';

/** Resolved per call rather than at module load, so the config a process reads
 * is always the one belonging to the home directory it is running under. */
function configDir(): string {
  return join(homedir(), '.boardsmith');
}

function configFile(): string {
  return join(configDir(), 'config.json');
}

interface GlobalConfig {
  /** API keys are per platform target — dev/test/prod are separate deployments
   * with separate key stores, so one saved key must never be sent to another
   * target. */
  apiKeys?: Partial<Record<PlatformTarget, string>>;
}

export function readGlobalConfig(): GlobalConfig {
  const file = configFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as GlobalConfig;
  } catch {
    return {};
  }
}

export function writeGlobalConfig(config: GlobalConfig): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(config, null, 2) + '\n');
}

export function getApiKey(target: PlatformTarget): string | undefined {
  return readGlobalConfig().apiKeys?.[target];
}

export function saveApiKey(target: PlatformTarget, apiKey: string): void {
  const config = readGlobalConfig();
  config.apiKeys = { ...config.apiKeys, [target]: apiKey };
  writeGlobalConfig(config);
}

/** True when the config still carries the single pre-taxonomy `apiKey` field,
 * which no target reads. `publish` uses this to say why a key that is visibly
 * in the file is not being used, instead of silently claiming there is none. */
export function hasLegacyApiKeyField(): boolean {
  return 'apiKey' in (readGlobalConfig() as Record<string, unknown>);
}

/** The config file a `boardsmith publish --api-key` writes to, for error messages. */
export function globalConfigPath(): string {
  return configFile();
}
