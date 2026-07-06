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
 * of what `src` resolves to, so `boardsmith build`/`boardsmith lint` and any
 * future caller all delegate here rather than growing a second, subtly
 * different regex scanner.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

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

const BARE_IMG_TAG = /<img\b/;

/**
 * Scan `<cwd>/src/ui` for bare `<img` tags outside `AssetImage.vue`.
 * Returns one violation per offending line; an empty array is a PASS.
 */
export function scanAssetReachability(cwd: string): AssetViolation[] {
  const uiDir = join(cwd, 'src', 'ui');
  if (!existsSync(uiDir)) return [];

  const violations: AssetViolation[] = [];

  for (const filePath of collectSourceFiles(uiDir)) {
    // AssetImage.vue's own <img> definition is the sanctioned wrapper — excluded
    // by basename regardless of directory.
    if (basename(filePath) === 'AssetImage.vue') continue;

    const content = readFileSync(filePath, 'utf-8');
    const relPath = relative(cwd, filePath);
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
