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

  // Adversarial (T3, T-162-01): over-strip guard — a live <img> AFTER a line
  // comment opener on the SAME line must still be reported if it comes before
  // the `//`; and a live <img> that follows a closed block comment on the same
  // line must still be caught. Here: comment then live tag on separate
  // segments of one line — the live one must not be swallowed by the strip.
  it('still flags a live <img> that appears on the same line as a comment, before the comment opens', () => {
    const violations = scanWith({
      'src/ui/components/GameTable.vue':
        '<template>\n  <img :src="cardImage" /> <!-- legacy: was <img src="/cards/old.svg" /> -->\n</template>',
    });
    expect(violations.length).toBe(1);
    expect(violations[0].line).toBe(2);
  });

  it('does NOT flag a live <img> that is genuinely inside a block comment opened earlier on the same line', () => {
    const violations = scanWith({
      'src/ui/components/GameTable.vue':
        '<script setup lang="ts">\n/* deprecated: <img src="/cards/old.svg" /> */\nconst x = 1;\n</script>',
    });
    expect(violations).toEqual([]);
  });

  // Adversarial (T3): a string literal containing the text `<img` that is NOT a
  // comment must still be flagged — proves the strip is comment-scoped, not a
  // blanket suppression of anything resembling markup in a literal. Current
  // behavior (pre- and post-D17) is unchanged: bare-string `<img` still counts
  // as a bare <img> tag per the coarse heuristic this scanner uses.
  it('still flags <img> text inside a non-comment string literal (strip must not touch live literals)', () => {
    const violations = scanWith({
      'src/ui/components/GameTable.vue':
        '<script setup lang="ts">\nconst s = "<img src=\'/cards/x.svg\'>";\n</script>',
    });
    expect(violations.length).toBe(1);
    expect(violations[0].line).toBe(2);
  });

  // Adversarial (T3): an unterminated block comment must not crash and must not
  // produce a spurious violation for anything after the open — every following
  // line stays stripped since the comment never closes.
  it('handles an unterminated block comment without crashing, stripping every subsequent line', () => {
    const violations = scanWith({
      'src/ui/components/GameTable.vue':
        '<script setup lang="ts">\n/* unterminated\n<img src="/cards/never-closes.svg" />\nstill inside, another <img tag here\n</script>',
    });
    expect(violations).toEqual([]);
  });
});
