import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanAssetReachability } from './asset-scan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '__fixtures__', 'asset-scan');

describe('scanAssetReachability', () => {
  // Pitfall 2: the scan must be a file-system-level static check, never an HTTP
  // probe (Vite's SPA fallback returns 200 for missing assets, which would make
  // an HTTP-based reachability check falsely pass every time).
  it('flags a bare <img> tag outside AssetImage.vue as a violation', () => {
    const violations = scanAssetReachability(join(FIXTURES, 'bare-img'));
    expect(violations.length).toBeGreaterThan(0);
    const violation = violations.find((v) =>
      v.file.endsWith('src/ui/components/GameTable.vue'),
    );
    expect(violation).toBeDefined();
    expect(violation?.line).toBe(4);
    expect(violation?.message).toMatch(/AssetImage/);
  });

  it('passes when the same UI routes art through AssetImage.vue', () => {
    const violations = scanAssetReachability(join(FIXTURES, 'wrapped'));
    expect(violations).toEqual([]);
  });

  it('returns an empty array when src/ui is absent', () => {
    const violations = scanAssetReachability(join(FIXTURES, 'does-not-exist'));
    expect(violations).toEqual([]);
  });
});
