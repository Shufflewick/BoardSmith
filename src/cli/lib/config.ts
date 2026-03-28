import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.boardsmith');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface GlobalConfig {
  apiKey?: string;
}

export function readGlobalConfig(): GlobalConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function writeGlobalConfig(config: GlobalConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

export function getApiKey(): string | undefined {
  return readGlobalConfig().apiKey;
}

export function saveApiKey(apiKey: string): void {
  const config = readGlobalConfig();
  config.apiKey = apiKey;
  writeGlobalConfig(config);
}
