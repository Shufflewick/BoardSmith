import { describe, it, expect } from 'vitest';
import type { GameDefinition } from '../../session/index.js';
import { deriveManifest } from './build.js';

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
