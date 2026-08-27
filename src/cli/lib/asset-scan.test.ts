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

  // Issue #81 — AssetImage now lives in boardsmith/ui, so NO file in a game may
  // carry a bare <img>. A hand-rolled per-game copy is the exact drift the hoist
  // removed, and re-creating one under the old scaffold path no longer buys an
  // exemption from the gate.
  it('flags a hand-rolled src/ui/components/AssetImage.vue — no path is exempt', () => {
    const violations = scanWith({
      'src/ui/components/AssetImage.vue': '<template>\n  <img :src="src" @load="onLoad" @error="onError" />\n</template>',
    });
    expect(violations.length).toBe(1);
    expect(violations[0].file).toContain('AssetImage.vue');
  });

  it('flags an AssetImage.vue placed elsewhere too (basename never bypassed the gate)', () => {
    const violations = scanWith({
      'src/ui/components/legacy/AssetImage.vue': '<template>\n  <img src="/cards/AH.svg" />\n</template>',
    });
    expect(violations.length).toBe(1);
    expect(violations[0].file).toContain('legacy/AssetImage.vue');
  });

  it("points an offender at the library import rather than a file it no longer has", () => {
    const violations = scanWith({
      'src/ui/components/GameTable.vue': '<template>\n  <img src="/cards/AH.svg" />\n</template>',
    });
    expect(violations[0].message).toContain("boardsmith/ui");
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
  // WR-01: an unterminated block comment silently swallows the rest of the
  // file (every <img> after it goes unscanned). Rather than a silent PASS,
  // this must surface a loud, actionable violation of its own naming the
  // line the comment opened on -- a malformed source file must not silently
  // disable the gate for everything after it.
  it('surfaces a loud violation for an unterminated block comment instead of silently passing (WR-01)', () => {
    const violations = scanWith({
      'src/ui/components/GameTable.vue':
        '<script setup lang="ts">\n/* unterminated\n<img src="/cards/never-closes.svg" />\nstill inside, another <img tag here\n</script>',
    });
    expect(violations.length).toBe(1);
    expect(violations[0].line).toBe(2);
    expect(violations[0].message).toMatch(/unterminated/i);
  });

  // CR-02: a `//` inside a quoted attribute value (a protocol-relative URL,
  // e.g. `href="//example.com"`) is NOT a comment opener. Pre-fix, the
  // detector only guards `https://`-style `:`-prefixed URLs, so this bare
  // `//` gets treated as a line-comment opener and blanks the rest of the
  // line -- silently swallowing a genuine bare <img> tag later on the SAME
  // line and defeating the ASSET-02 build gate.
  it('still flags a live <img> on the same line as a protocol-relative URL attribute value (CR-02: quote-aware // detection)', () => {
    const violations = scanWith({
      'src/ui/components/GameTable.vue':
        '<template>\n  <a href="//example.com"><img src="x.png"></a>\n</template>',
    });
    expect(violations.length).toBe(1);
    expect(violations[0].line).toBe(2);
  });

  // CR-02: a live `//` inside a JS string literal must not be treated as a
  // comment opener either -- a bare <img> that follows the string (but
  // precedes a REAL trailing `//` comment) on the same line must still be
  // flagged, while the real comment further right on that line still blanks
  // correctly.
  it('does not treat a `//` inside a JS string literal as a comment opener (a live <img> between the string and the real trailing comment is still flagged)', () => {
    const violations = scanWith({
      'src/ui/components/GameTable.vue':
        '<script setup lang="ts">\nconst x = "a // b"; <img src="x.png"> // real comment\n</script>',
    });
    expect(violations.length).toBe(1);
    expect(violations[0].line).toBe(2);
  });

  // F-11 (v4.8): stripComments must NOT apply JS `//` line-comment lexing to
  // Vue TEMPLATE text. `//` in template text (e.g. "score // bonus") is literal
  // content, not a comment — treating it as one blanks the rest of the line
  // including a genuine bare <img>, defeating the gate.
  it('F-11: a `//` in template text is NOT a comment and does not swallow a following live <img>', () => {
    const violations = scanWith({
      'src/ui/components/GameTable.vue':
        '<template>\n  <div>score // bonus</div><img src="/x.png" />\n</template>',
    });
    expect(violations.length).toBe(1);
    expect(violations[0].line).toBe(2);
  });

  // F-11 (v4.8): an apostrophe in TEMPLATE text ("Player's hand") must NOT open
  // JS string-quote state. Pre-fix it did, so a following genuine
  // `<!-- <img> -->` HTML comment on the same line was not recognized and its
  // <img> was flagged (a spurious FAIL retriggerable by ordinary English).
  it('F-11: an apostrophe in template text does not phantom-quote a following HTML comment (no false FAIL)', () => {
    const violations = scanWith({
      'src/ui/components/GameTable.vue':
        "<template>\n  <div>Player's hand <!-- <img src=\"/old.svg\" /> --></div>\n</template>",
    });
    expect(violations).toEqual([]);
  });
});
