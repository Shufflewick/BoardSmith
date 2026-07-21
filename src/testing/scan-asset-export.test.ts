import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// TOOL-02 (D18): scanAssetReachability must be importable from the published
// boardsmith/testing barrel, not just its internal relative path.
import { scanAssetReachability } from 'boardsmith/testing';

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

describe('scanAssetReachability export surface (boardsmith/testing)', () => {
  it('resolves to a callable function', () => {
    expect(typeof scanAssetReachability).toBe('function');
  });

  it('scans a real fixture and returns no violations for an AssetImage-wrapped UI', () => {
    expect(scanAssetReachability(WRAPPED_FIXTURE)).toEqual([]);
  });
});
