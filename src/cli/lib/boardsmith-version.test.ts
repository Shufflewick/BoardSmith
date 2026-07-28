import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readBoardsmithVersion } from './boardsmith-version.js';

/**
 * `readBoardsmithVersion()` exists because `src/cli/cli.ts:27` hardcoded `.version('0.0.1')` and
 * never read `package.json` — so `boardsmith --version` reported a stale literal regardless of
 * what the package actually shipped (171-CONTEXT.md decision 9). These tests pin the fix: the
 * reported version must equal what `package.json` says, always, with no fallback string standing
 * in when it cannot be found.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/cli/lib -> repo root is three levels up
const REPO_ROOT = join(__dirname, '..', '..', '..');

describe('readBoardsmithVersion', () => {
  it('returns the version field of the repo\'s own package.json', async () => {
    const pkgRaw = await fs.readFile(join(REPO_ROOT, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw);
    expect(readBoardsmithVersion()).toBe(pkg.version);
  });

  it('matches a semver-shaped string', () => {
    expect(readBoardsmithVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('src/cli/cli.ts contains no hardcoded quoted semver literal passed to .version()', async () => {
    const cliSource = await fs.readFile(join(REPO_ROOT, 'src', 'cli', 'cli.ts'), 'utf-8');
    expect(cliSource).not.toMatch(/\.version\(['"]\d/);
  });
});
