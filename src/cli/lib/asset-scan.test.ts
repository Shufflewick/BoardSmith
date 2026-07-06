import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { scanAssetReachability } from './asset-scan.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '__fixtures__', 'asset-scan');

/** Write a single UI source file into a throwaway project and scan it. */
function scanWith(files: Record<string, string>): ReturnType<typeof scanAssetReachability> {
  const root = mkdtempSync(join(tmpdir(), 'asset-scan-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf-8');
    }
    return scanAssetReachability(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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

  // WR-02 — regex robustness
  it('flags an uppercase <IMG> tag (HTML tag names are case-insensitive)', () => {
    const violations = scanWith({
      'src/ui/components/GameTable.vue': '<template>\n  <IMG src="/cards/AH.svg" />\n</template>',
    });
    expect(violations.length).toBe(1);
  });

  it('does NOT flag kebab-case custom elements like <img-carousel> (false-positive guard)', () => {
    const violations = scanWith({
      'src/ui/components/GameTable.vue': '<template>\n  <img-carousel :items="cards" />\n</template>',
    });
    expect(violations).toEqual([]);
  });

  // WR-01 — the wrapper is excluded by its canonical path, not merely its basename
  it('excludes the canonical src/ui/components/AssetImage.vue from the gate', () => {
    const violations = scanWith({
      'src/ui/components/AssetImage.vue': '<template>\n  <img :src="src" @load="onLoad" @error="onError" />\n</template>',
    });
    expect(violations).toEqual([]);
  });

  it('still flags a second AssetImage.vue placed elsewhere (basename cannot bypass the gate)', () => {
    const violations = scanWith({
      'src/ui/components/legacy/AssetImage.vue': '<template>\n  <img src="/cards/AH.svg" />\n</template>',
    });
    expect(violations.length).toBe(1);
    expect(violations[0].file).toContain('legacy/AssetImage.vue');
  });
});
