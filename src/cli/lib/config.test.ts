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
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

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
  home = tempTree('boardsmith-config-');
  process.env.HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

describe('readGlobalConfig / getApiKey', () => {
  it('reads a key back for the target it was saved under', () => {
    saveApiKey('dev', 'spk_dev_key');
    expect(getApiKey('dev')).toBe('spk_dev_key');
  });

  it('never hands one target the key saved for another', () => {
    saveApiKey('dev', 'spk_dev_key');
    expect(getApiKey('prod')).toBeUndefined();
  });

  it('does not resurrect a pre-taxonomy `apiKey` field as a target key', () => {
    writeConfigFile({ apiKey: 'spk_old_key' });
    expect(getApiKey('dev')).toBeUndefined();
  });

  it('does not rewrite the user\'s config file just because it read it', () => {
    writeConfigFile({ apiKey: 'spk_old_key' });
    const before = readFileSync(configFile(), 'utf-8');
    getApiKey('dev');
    expect(readFileSync(configFile(), 'utf-8')).toBe(before);
  });

  it('treats a missing config as simply having no keys', () => {
    expect(existsSync(configFile())).toBe(false);
    expect(getApiKey('prod')).toBeUndefined();
  });

  it('refuses an unparseable config with a message naming the file and the fix', () => {
    mkdirSync(join(home, '.boardsmith'), { recursive: true });
    writeFileSync(configFile(), 'not json at all');
    expect(() => getApiKey('prod')).toThrow(
      `${configFile()} is not valid JSON. Fix the typo in it, or delete it and save your keys again with boardsmith publish --api-key.`
    );
  });

  it('never overwrites an unparseable config when saving a key', () => {
    mkdirSync(join(home, '.boardsmith'), { recursive: true });
    writeFileSync(configFile(), '{ "apiKeys": { "dev": "spk_dev_key", } }');
    expect(() => saveApiKey('prod', 'spk_prod_key')).toThrow(/is not valid JSON/);
    expect(readFileSync(configFile(), 'utf-8')).toBe('{ "apiKeys": { "dev": "spk_dev_key", } }');
  });
});

describe('writeGlobalConfig permissions', () => {
  it('creates the config file readable only by its owner, in a folder only its owner can enter', () => {
    saveApiKey('dev', 'spk_dev_key');
    expect(statSync(configFile()).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, '.boardsmith')).mode & 0o777).toBe(0o700);
  });

  it('tightens an existing world-readable config file to owner-only when saving a key', () => {
    writeConfigFile({});
    chmodSync(configFile(), 0o644);
    saveApiKey('dev', 'spk_dev_key');
    expect(statSync(configFile()).mode & 0o777).toBe(0o600);
  });
});
