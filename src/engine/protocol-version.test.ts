/**
 * The two version numbers the platform reads off the `boardsmith` barrel.
 * `src/contract/engine-contract.test.ts` guards the contract FILE; this file
 * guards what the engine actually exports from it, since that is what a
 * vendored platform copy imports and what `boardsmith build` stamps into a
 * published manifest.
 */
import { describe, it, expect } from 'vitest';
import { BUNDLE_PROTOCOL_VERSION, ENGINE_REVISION, ENGINE_CONTRACT } from './index.js';
import contract from '../contract/engine-contract.json' with { type: 'json' };

describe('BUNDLE_PROTOCOL_VERSION', () => {
  it('is the bundleProtocol recorded in engine-contract.json', () => {
    expect(BUNDLE_PROTOCOL_VERSION).toBe(contract.bundleProtocol);
  });

  it('re-exports the same value the contract object carries', () => {
    expect(BUNDLE_PROTOCOL_VERSION).toBe(ENGINE_CONTRACT.bundleProtocol);
  });

  it('is a positive integer, so a manifest comparison is exact', () => {
    expect(Number.isInteger(BUNDLE_PROTOCOL_VERSION)).toBe(true);
    expect(BUNDLE_PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});

describe('ENGINE_REVISION', () => {
  it('is the revision recorded in engine-contract.json', () => {
    expect(ENGINE_REVISION).toBe(contract.revision);
  });

  it('re-exports the same value the contract object carries', () => {
    expect(ENGINE_REVISION).toBe(ENGINE_CONTRACT.revision);
  });

  it('is a positive integer', () => {
    expect(Number.isInteger(ENGINE_REVISION)).toBe(true);
    expect(ENGINE_REVISION).toBeGreaterThan(0);
  });

  it('moves at least as often as the bundle protocol', () => {
    // Every ABI break is also a surface change, so the revision can never lag
    // the protocol — if it did, the platform could accept a bundle built
    // against an engine it has not vendored.
    expect(ENGINE_REVISION).toBeGreaterThanOrEqual(BUNDLE_PROTOCOL_VERSION);
  });
});

describe('the pair the build stamps', () => {
  it('are the two numbers a published manifest carries', async () => {
    const { deriveManifest } = await import('../cli/commands/build.js');
    const manifest = deriveManifest(
      { name: 'test-game' },
      { minPlayers: 2, maxPlayers: 4 },
      { protocol: BUNDLE_PROTOCOL_VERSION, revision: ENGINE_REVISION }
    );
    expect(manifest.engineProtocol).toBe(BUNDLE_PROTOCOL_VERSION);
    expect(manifest.engineRevision).toBe(ENGINE_REVISION);
  });
});
