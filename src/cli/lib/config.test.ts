/**
 * The global CLI config: how a saved API key is read back per platform target.
 *
 * The pre-taxonomy config stored a single `apiKey` field for what was then the
 * only target. There is deliberately no migration for it (issue #59): the
 * project bans back-compat shims, and a shim that rewrites a human-owned file
 * on every read is the worst kind. A stale field is inert, and `publish` says
 * so in words.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getApiKey, saveApiKey } from './config.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let home: string;
let originalHome: string | undefined;

function configFile(): string {
  return join(home, '.boardsmith', 'config.json');
}

function writeConfigFile(contents: unknown): void {
  mkdirSync(join(home, '.boardsmith'), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(contents, null, 2));
}

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'boardsmith-config-'));
  process.env.HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe('readGlobalConfig / getApiKey', () => {
  it('reads a key back for the target it was saved under', () => {
    saveApiKey('test', 'spk_test_key');
    expect(getApiKey('test')).toBe('spk_test_key');
  });

  it('never hands one target the key saved for another', () => {
    saveApiKey('test', 'spk_test_key');
    expect(getApiKey('prod')).toBeUndefined();
    expect(getApiKey('dev')).toBeUndefined();
  });

  it('does not resurrect a pre-taxonomy `apiKey` field as the test key', () => {
    writeConfigFile({ apiKey: 'spk_old_key' });
    expect(getApiKey('test')).toBeUndefined();
  });

  it('does not rewrite the user\'s config file just because it read it', () => {
    writeConfigFile({ apiKey: 'spk_old_key' });
    const before = readFileSync(configFile(), 'utf-8');
    getApiKey('test');
    expect(readFileSync(configFile(), 'utf-8')).toBe(before);
  });

  it('treats a missing or unparseable config as simply having no keys', () => {
    expect(existsSync(configFile())).toBe(false);
    expect(getApiKey('prod')).toBeUndefined();

    mkdirSync(join(home, '.boardsmith'), { recursive: true });
    writeFileSync(configFile(), 'not json at all');
    expect(getApiKey('prod')).toBeUndefined();
  });
});
