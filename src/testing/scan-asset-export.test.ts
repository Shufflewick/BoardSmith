import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// TOOL-02 (D18): scanAssetReachability must be importable from a PUBLISHED
// subpath, not only by a relative path into the package's internals — games
// were reaching it via `../node_modules/boardsmith/src/cli/lib/asset-scan.js`
// because no export surfaced it.
import { scanAssetReachability } from 'boardsmith/asset-scan';
import * as testingBarrel from 'boardsmith/testing';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WRAPPED_FIXTURE = join(
  __dirname,
  '..',
  'cli',
  'lib',
  '__fixtures__',
  'asset-scan',
  'wrapped',
);

describe('scanAssetReachability export surface (boardsmith/asset-scan)', () => {
  it('resolves to a callable function', () => {
    expect(typeof scanAssetReachability).toBe('function');
  });

  it('scans a real fixture and returns no violations for an AssetImage-wrapped UI', () => {
    expect(scanAssetReachability(WRAPPED_FIXTURE)).toEqual([]);
  });

  it('is NOT re-exported from boardsmith/testing, which must stay Node-free', () => {
    // The gate reads the filesystem. `boardsmith/testing` is what every game
    // imports for `createTestGame`, so re-exporting it here pulled `node:fs`
    // into the type graph of games that never call it — and a game whose
    // tsconfig includes tests/ then failed `boardsmith validate` with
    // "Cannot find module 'node:fs'" unless it added @types/node.
    //
    // Re-adding the barrel export turns this red. Use the subpath instead.
    expect(testingBarrel).not.toHaveProperty('scanAssetReachability');
  });
});
