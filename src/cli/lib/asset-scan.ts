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
 */
function stripComments(lines: string[]): string[] {
  const stripped: string[] = [];
  // Which multi-line comment kind (if any) is open going INTO this line.
  let openKind: 'block' | 'html' | null = null;

  for (const line of lines) {
    let out = '';
    let i = 0;

    while (i < line.length) {
      if (openKind === 'block') {
        const close = line.indexOf('*/', i);
        if (close === -1) {
          out += ' '.repeat(line.length - i);
          i = line.length;
        } else {
          out += ' '.repeat(close + 2 - i);
          i = close + 2;
          openKind = null;
        }
        continue;
      }
      if (openKind === 'html') {
        const close = line.indexOf('-->', i);
        if (close === -1) {
          out += ' '.repeat(line.length - i);
          i = line.length;
        } else {
          out += ' '.repeat(close + 3 - i);
          i = close + 3;
          openKind = null;
        }
        continue;
      }

      // Not currently inside a comment — look for the nearest comment opener.
      // A `//` immediately preceded by `:` is a URL scheme separator (e.g.
      // `https://...`), not a line comment — skip past it and keep scanning.
      let lineOpen = -1;
      for (let search = i; ; ) {
        const found = line.indexOf('//', search);
        if (found === -1) {
          lineOpen = -1;
          break;
        }
        if (line[found - 1] === ':') {
          search = found + 2;
          continue;
        }
        lineOpen = found;
        break;
      }
      const blockOpen = line.indexOf('/*', i);
      const htmlOpen = line.indexOf('<!--', i);

      const candidates = [lineOpen, blockOpen, htmlOpen].filter((idx) => idx !== -1);
      if (candidates.length === 0) {
        out += line.slice(i);
        i = line.length;
        continue;
      }

      const next = Math.min(...candidates);
      out += line.slice(i, next);

      if (next === lineOpen) {
        out += ' '.repeat(line.length - next);
        i = line.length;
      } else if (next === blockOpen) {
        out += ' '.repeat(2);
        i = next + 2;
        openKind = 'block';
      } else {
        out += ' '.repeat(4);
        i = next + 4;
        openKind = 'html';
      }
    }

    stripped.push(out);
  }

  return stripped;
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
    const scanLines = stripComments(lines);
    for (let i = 0; i < lines.length; i++) {
      if (BARE_IMG_TAG.test(scanLines[i])) {
        violations.push({
          file: relPath,
          line: i + 1,
          message: `${relPath}:${i + 1} uses a bare <img> tag. Route art through <AssetImage :src=... kind="..." /> instead so missing assets fall back cleanly rather than shipping a broken image.`,
        });
      }
    }
  }

  return violations;
}
