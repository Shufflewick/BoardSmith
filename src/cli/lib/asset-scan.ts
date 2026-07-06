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
    for (let i = 0; i < lines.length; i++) {
      if (BARE_IMG_TAG.test(lines[i])) {
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
