/**
 * Asset-reachability scanner — the single source of truth for ASSET-02's
 * build-blocking gate.
 *
 * It is a file-system-level static scan: it never issues an HTTP request. Vite's
 * SPA fallback serves a 200 for any unmatched path, including missing images, so
 * an HTTP-based "is this asset reachable?" probe would falsely pass every time
 * (Pitfall 2). Instead this scan reads generated UI source directly off disk and
 * flags any bare `<img` tag found outside `AssetImage.vue`'s own definition — the
 * coarse, pit-of-success heuristic locked in 152-CONTEXT.md. Routing art through
 * `<AssetImage>` is the one sanctioned path; anything else is a FAIL regardless
 * of what `src` resolves to. Today the `bs-build-chunk` skill's `test` step is the
 * caller (see build/test.md); any future CLI wiring (`boardsmith build`/`lint`)
 * should delegate here too rather than growing a second, subtly different regex
 * scanner — the single-source-of-truth pattern `sandbox-scan.ts` established.
 *
 * WR-02: this module is re-exported from `boardsmith/testing`
 * (`src/testing/index.ts`) so games can call the gate directly. It is ALSO
 * imported by a hardcoded relative path from the `bs-build-chunk` skill's
 * `build/test.md`. If you move or rename this file, update BOTH of those
 * importers — neither is caught by this package's own type-check.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface AssetViolation {
  /** Path relative to the project root. */
  file: string;
  line: number;
  message: string;
}

function collectSourceFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, files);
      continue;
    }
    if (/\.(vue|ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

// A real <img> tag: `<img` followed by whitespace, `/`, or `>` — case-insensitive
// (HTML tag names are). The trailing class excludes kebab-case custom elements
// like `<img-carousel>` (a false positive `\b` would have matched).
const BARE_IMG_TAG = /<img[\s/>]/i;

// The one sanctioned wrapper, identified by its canonical scaffold-relative path
// (not just basename) so a stray/second file merely named AssetImage.vue elsewhere
// cannot bypass the gate.
const ASSET_IMAGE_RELATIVE_PATH = join('src', 'ui', 'components', 'AssetImage.vue');

/**
 * Blank out comment spans (JS `//`, JS `/* *\/`, Vue `<!-- -->`) across an entire
 * file's lines, replacing comment characters with spaces so every line keeps its
 * original length and 1-based index — callers that report `AssetViolation.line`
 * against the ORIGINAL source stay accurate. Block-comment and HTML-comment open
 * state is tracked ACROSS line boundaries (a `/* *\/` or `<!-- -->` can span many
 * lines). Only comment content is stripped — live markup and string literals are
 * left untouched (D17 fix is comment-scoped only, not a second/looser detector).
 *
 * CR-02: comment-opener detection is quote-aware WITHIN each line — a `//`,
 * `/*`, or `<!--` sequence that appears INSIDE a live single/double/backtick
 * quoted span (an HTML attribute value like `href="//example.com"`, or a JS
 * string literal like `"a // b"`) is never treated as a comment opener. A
 * naive scanner that only special-cases `https://`-style `:`-prefixed URLs
 * blanks the rest of the line on any OTHER live `//` — including a bare
 * `<img>` tag later on that same line — silently defeating the ASSET-02
 * build gate. Quote state resets at the start of each live (non-comment)
 * segment scanned and does not persist across lines (multi-line JS template
 * literals are out of scope — see 162-CONTEXT.md D17 discretion).
 */
interface StripCommentsResult {
  lines: string[];
  /**
   * WR-01: set when a block/HTML comment opener is never closed by EOF —
   * everything after it was silently blanked (treated as commented-out) and
   * NOT scanned for bare `<img>` tags. `line` is the 1-based line the
   * comment opened on; `kind` distinguishes `/* *\/` from `<!-- -->`.
   */
  unterminated?: { line: number; kind: 'block' | 'html' };
}

function stripComments(lines: string[]): StripCommentsResult {
  const stripped: string[] = [];
  // Which multi-line comment kind (if any) is open going INTO this line.
  let openKind: 'block' | 'html' | null = null;
  let openedAtLine: number | undefined;
  // F-11: a `.vue` file mixes regions with DIFFERENT comment/quote grammars.
  // JS `//` line comments, `/* */` block comments and string-quote tracking are
  // valid ONLY inside `<script>`; `<style>` has `/* */` + quotes but no `//`;
  // the TEMPLATE region has ONLY `<!-- -->` HTML comments — apostrophes and
  // `//` there are literal text. Applying JS lexing to template text both
  // defeated the gate (a `//` blanked a following real <img>) and produced
  // false FAILs (an apostrophe phantom-quoted a following `<!-- <img> -->`).
  // Track the region so each grammar applies only where it is valid. The region
  // persists across lines (script/style blocks span lines); the file is scanned
  // fresh per call so no cross-file leakage.
  let region: 'template' | 'script' | 'style' = 'template';

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let out = '';
    let i = 0;
    // Quote state is intentionally per-line (multi-line template literals are
    // out of scope — see the interface doc).
    let quote: string | null = null;

    while (i < line.length) {
      // Inside a multi-line comment: consume until its closer.
      if (openKind === 'block') {
        const close = line.indexOf('*/', i);
        if (close === -1) { out += ' '.repeat(line.length - i); i = line.length; }
        else { out += ' '.repeat(close + 2 - i); i = close + 2; openKind = null; }
        continue;
      }
      if (openKind === 'html') {
        const close = line.indexOf('-->', i);
        if (close === -1) { out += ' '.repeat(line.length - i); i = line.length; }
        else { out += ' '.repeat(close + 3 - i); i = close + 3; openKind = null; }
        continue;
      }

      const ch = line[i];

      // Inside a string literal (script/style only — template never enters one).
      if (quote) {
        if (ch === '\\' && quote !== '`') { out += line.slice(i, i + 2); i += 2; continue; }
        if (ch === quote) quote = null;
        out += ch;
        i++;
        continue;
      }

      // Region EXIT: `</script>` / `</style>` returns to template.
      if (region === 'script' && line.startsWith('</script', i)) { region = 'template'; out += ch; i++; continue; }
      if (region === 'style' && line.startsWith('</style', i)) { region = 'template'; out += ch; i++; continue; }

      if (region === 'template') {
        // Region ENTER: `<script`/`<style` switch grammar for what follows.
        if (line.startsWith('<script', i)) { region = 'script'; out += ch; i++; continue; }
        if (line.startsWith('<style', i)) { region = 'style'; out += ch; i++; continue; }
        // The ONLY comment in template is the HTML comment.
        if (line.startsWith('<!--', i)) { out += '    '; i += 4; openKind = 'html'; openedAtLine = lineIdx + 1; continue; }
        // Everything else (including `'`, `"`, `//`, `/*`) is literal text.
        out += ch;
        i++;
        continue;
      }

      // region is 'script' or 'style' — apply the relevant lexing.
      // String literals: JS uses ' " ` ; CSS uses ' " .
      if (ch === '"' || ch === "'" || (region === 'script' && ch === '`')) { quote = ch; out += ch; i++; continue; }
      // Line comments: JS only. A `//` preceded by `:` is a URL scheme separator.
      if (region === 'script' && ch === '/' && line[i + 1] === '/') {
        if (line[i - 1] === ':') { out += '//'; i += 2; continue; }
        out += ' '.repeat(line.length - i);
        i = line.length;
        continue;
      }
      // Block comments: JS and CSS.
      if (ch === '/' && line[i + 1] === '*') { out += '  '; i += 2; openKind = 'block'; openedAtLine = lineIdx + 1; continue; }
      // HTML comments can legally appear even inside <script> in a .vue SFC's
      // raw text in rare cases, but bare <img> never lives in script/style, so
      // no HTML-comment handling is needed here — treat as literal.
      out += ch;
      i++;
    }

    stripped.push(out);
  }

  return {
    lines: stripped,
    unterminated: openKind ? { line: openedAtLine!, kind: openKind } : undefined,
  };
}

/**
 * Scan `<cwd>/src/ui` for bare `<img` tags outside `AssetImage.vue`.
 * Returns one violation per offending line; an empty array is a PASS.
 */
export function scanAssetReachability(cwd: string): AssetViolation[] {
  const uiDir = join(cwd, 'src', 'ui');
  if (!existsSync(uiDir)) return [];

  const violations: AssetViolation[] = [];

  for (const filePath of collectSourceFiles(uiDir)) {
    const relPath = relative(cwd, filePath);
    // AssetImage.vue's own <img> definition is the sanctioned wrapper — excluded
    // by its canonical path, not merely its basename.
    if (relPath === ASSET_IMAGE_RELATIVE_PATH) continue;

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const { lines: scanLines, unterminated } = stripComments(lines);
    for (let i = 0; i < lines.length; i++) {
      if (BARE_IMG_TAG.test(scanLines[i])) {
        violations.push({
          file: relPath,
          line: i + 1,
          message: `${relPath}:${i + 1} uses a bare <img> tag. Route art through <AssetImage :src=... kind="..." /> instead so missing assets fall back cleanly rather than shipping a broken image.`,
        });
      }
    }

    // WR-01: a comment that never closes silently blanks everything after
    // it (including any real <img> tags) -- fail loud with an actionable
    // violation instead of a false PASS.
    if (unterminated) {
      const commentLabel = unterminated.kind === 'block' ? '/* block' : '<!-- HTML';
      violations.push({
        file: relPath,
        line: unterminated.line,
        message: `${relPath}:${unterminated.line} has an unterminated ${commentLabel} comment that is never closed. Everything after it was NOT scanned for bare <img> tags, so this is a false PASS risk -- close the comment (or remove the stray opener).`,
      });
    }
  }

  return violations;
}
