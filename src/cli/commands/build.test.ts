import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { GameDefinition } from '../../session/index.js';
import { deriveManifest } from './build.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Minimal fixture gameDefinition — only the fields deriveManifest reads
 * (minPlayers/maxPlayers) are meaningful; the rest satisfy the type.
 */
function makeGameDefinition(minPlayers: number, maxPlayers: number): GameDefinition {
  return {
    gameClass: class {} as unknown as GameDefinition['gameClass'],
    gameType: 'fixture',
    minPlayers,
    maxPlayers,
  };
}

describe('deriveManifest', () => {
  it('derives playerCount from gameDefinition.minPlayers/maxPlayers', () => {
    const config = { name: 'fixture', displayName: 'Fixture Game' };
    const gameDefinition = makeGameDefinition(2, 4);

    const manifest = deriveManifest(config, gameDefinition, 1);

    expect(manifest.playerCount).toEqual({ min: 2, max: 4 });
  });

  it('PROC-02: a stale config playerCount does NOT reach the manifest — gameDefinition wins', () => {
    // Stale/hand-edited boardsmith.json claiming a 9-9 player count, while the
    // compiled rules (gameDefinition) say 2-4. This is exactly the drift
    // scenario T-135-07 must prevent: a raw `{ ...config }` spread would let
    // the stale 9/9 ride into the manifest unchanged.
    const config = { name: 'fixture', playerCount: { min: 9, max: 9 } };
    const gameDefinition = makeGameDefinition(2, 4);

    const manifest = deriveManifest(config, gameDefinition, 1);

    expect(manifest.playerCount).toEqual({ min: 2, max: 4 });
    expect(manifest.playerCount).not.toEqual({ min: 9, max: 9 });
  });

  it('preserves buildTime/version/engineProtocol and other passthrough config keys', () => {
    const config = {
      name: 'fixture',
      displayName: 'Fixture Game',
      description: 'A test game',
      version: '2.0.0',
    };
    const gameDefinition = makeGameDefinition(1, 8);

    const manifest = deriveManifest(config, gameDefinition, 3);

    expect(manifest.name).toBe('fixture');
    expect(manifest.displayName).toBe('Fixture Game');
    expect(manifest.description).toBe('A test game');
    expect(manifest.version).toBe('2.0.0');
    expect(manifest.engineProtocol).toBe(3);
    expect(typeof manifest.buildTime).toBe('string');
    expect(() => new Date(manifest.buildTime as string).toISOString()).not.toThrow();
  });

  it('defaults version to 1.0.0 when config omits it', () => {
    const config = { name: 'fixture' };
    const gameDefinition = makeGameDefinition(2, 2);

    const manifest = deriveManifest(config, gameDefinition, 1);

    expect(manifest.version).toBe('1.0.0');
  });
});

// WR-02 regression: `.boardsmith` is a SHARED directory (pack tarballs,
// evolve-ai-weights' rules-bundle.mjs fallback, a running dev server's runtime
// bundle). build's temp-dir cleanup must only ever remove a build-owned
// subdirectory, never the shared parent.
describe('build temp-dir scoping (WR-02)', () => {
  const src = readFileSync(join(__dirname, 'build.ts'), 'utf-8');

  it('uses a build-owned subdirectory of .boardsmith as its temp dir', () => {
    expect(src).toContain("join(cwd, '.boardsmith', 'build-tmp')");
    // The shared parent must never be the temp dir itself.
    expect(src).not.toMatch(/tempDir = join\(cwd, '\.boardsmith'\)/);
  });

  it('only rmSyncs the scoped tempDir, never the shared .boardsmith parent', () => {
    const rmTargets = [...src.matchAll(/rmSync\(([^,)]+)/g)].map((m) => m[1].trim());
    expect(rmTargets).toEqual(['tempDir']);
  });
});
