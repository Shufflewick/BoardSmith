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

    const manifest = deriveManifest(config, gameDefinition, { protocol: 1, revision: 7 });

    expect(manifest.playerCount).toEqual({ min: 2, max: 4 });
  });

  it('carries the platform-consumed blocks through the config spread untouched', () => {
    // `world` (and its FR-006 siblings) have no derivation of their own: the
    // platform reads them straight out of manifest.json, so the spread is the
    // whole transport. If a future manifest allowlist ever replaces the
    // spread, this is the test that catches the drop.
    const config = {
      name: 'fixture',
      world: { resolveAction: { name: 'resolveRound', args: { scope: 'all' } }, enrolAction: { name: 'enrol' } },
      persistence: true,
      ai: true,
      joinInProgress: true,
      asyncPlay: true,
      idleAction: { name: 'pass' },
      roundDeadline: { defaultHours: 24, minHours: 6, maxHours: 72, mindingSafe: true },
    };

    const manifest = deriveManifest(config, makeGameDefinition(2, 4), { protocol: 1, revision: 7 });

    expect(manifest.world).toEqual(config.world);
    expect(manifest.persistence).toBe(true);
    expect(manifest.ai).toBe(true);
    expect(manifest.joinInProgress).toBe(true);
    expect(manifest.asyncPlay).toBe(true);
    expect(manifest.idleAction).toEqual({ name: 'pass' });
    expect(manifest.roundDeadline).toEqual(config.roundDeadline);
  });

  it('PROC-02: a stale config playerCount does NOT reach the manifest — gameDefinition wins', () => {
    // Stale/hand-edited boardsmith.json claiming a 9-9 player count, while the
    // compiled rules (gameDefinition) say 2-4. This is exactly the drift
    // scenario T-135-07 must prevent: a raw `{ ...config }` spread would let
    // the stale 9/9 ride into the manifest unchanged.
    const config = { name: 'fixture', playerCount: { min: 9, max: 9 } };
    const gameDefinition = makeGameDefinition(2, 4);

    const manifest = deriveManifest(config, gameDefinition, { protocol: 1, revision: 7 });

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

    const manifest = deriveManifest(config, gameDefinition, { protocol: 3, revision: 7 });

    expect(manifest.name).toBe('fixture');
    expect(manifest.displayName).toBe('Fixture Game');
    expect(manifest.description).toBe('A test game');
    expect(manifest.version).toBe('2.0.0');
    expect(manifest.engineProtocol).toBe(3);
    expect(manifest.engineRevision).toBe(7);
    expect(typeof manifest.buildTime).toBe('string');
    expect(() => new Date(manifest.buildTime as string).toISOString()).not.toThrow();
  });

  it('stamps engineRevision even when boardsmith.json tries to set its own', () => {
    // Both engine stamps are the BUILDING BoardSmith's to declare. If a hand
    // edited value could ride through the `...config` spread, a game could
    // claim an older revision than it was built against and defeat the
    // platform's skew check — so the derived values must overwrite, not merge.
    const config = { name: 'fixture', engineProtocol: 99, engineRevision: 99 };

    const manifest = deriveManifest(config, makeGameDefinition(2, 2), { protocol: 1, revision: 7 });

    expect(manifest.engineProtocol).toBe(1);
    expect(manifest.engineRevision).toBe(7);
  });

  it('defaults version to 1.0.0 when config omits it', () => {
    const config = { name: 'fixture' };
    const gameDefinition = makeGameDefinition(2, 2);

    const manifest = deriveManifest(config, gameDefinition, { protocol: 1, revision: 7 });

    expect(manifest.version).toBe('1.0.0');
  });

  it('passes the taxonomy fields (audience/tags/playtime/cooperative) through to the manifest', () => {
    const config = {
      name: 'fixture',
      audience: 'casual',
      tags: ['abstract', 'classic'],
      playtime: { min: 15, max: 30 },
      cooperative: false,
    };

    const manifest = deriveManifest(config, makeGameDefinition(2, 4), { protocol: 1, revision: 7 });

    expect(manifest.audience).toBe('casual');
    expect(manifest.tags).toEqual(['abstract', 'classic']);
    expect(manifest.playtime).toEqual({ min: 15, max: 30 });
    expect(manifest.cooperative).toBe(false);
  });

  it('throws an actionable error when the gameDefinition lacks minPlayers/maxPlayers', () => {
    // minPlayers/maxPlayers are optional on GameDefinition — a game that never
    // declared them must fail the BUILD with the fix, not publish a bundle
    // whose playerCount silently serialized to nothing.
    const gameDefinition = {} as Pick<GameDefinition, 'minPlayers' | 'maxPlayers'>;

    expect(() => deriveManifest({ name: 'fixture' }, gameDefinition, 1))
      .toThrow(/minPlayers\/maxPlayers.*src\/rules\/index\.ts/s);
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
