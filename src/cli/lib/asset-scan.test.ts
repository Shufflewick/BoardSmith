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

  // D17 — commented-out <img> tags (JS line, JS block, Vue HTML, and a multi-line
  // block comment) must NOT be reported as violations. This is a real false-FAIL
  // repro: pre-fix, all four commented occurrences wrongly flag.
  it('does NOT flag <img> tags that only appear inside comments (JS line, JS block, Vue HTML, multi-line block)', () => {
    const violations = scanAssetReachability(join(FIXTURES, 'commented-img'));
    const commentedLines = [2, 9, 12, 16];
    for (const line of commentedLines) {
      expect(violations.find((v) => v.line === line)).toBeUndefined();
    }
  });

  // Negative control: a genuinely-live <img> in the SAME fixture file (outside any
  // comment) IS still reported — proves the strip is comment-scoped, not a blanket
  // disable of the detector.
  it('still flags a genuinely-live <img> in a file that also contains commented-out <img> tags', () => {
    const violations = scanAssetReachability(join(FIXTURES, 'commented-img'));
    expect(violations.length).toBe(1);
    expect(violations[0].line).toBe(4);
    expect(violations[0].file.endsWith('src/ui/CommentedImg.vue')).toBe(true);
  });
});
