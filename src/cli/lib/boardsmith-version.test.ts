import { describe, it, expect, vi } from 'vitest';
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

const denyNextRead = vi.hoisted(() => ({ on: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    if (!denyNextRead.on) return actual.readFileSync(...args);
    denyNextRead.on = false;
    throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync };
});

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

  it('names a package.json it cannot read rather than walking past it (#1174)', async () => {
    vi.resetModules();
    // Dynamic import: a fresh copy of the module, whose found package is not cached yet.
    const { readBoardsmithVersion: fresh } = await import('./boardsmith-version.js');
    denyNextRead.on = true;
    expect(() => fresh()).toThrow(/Could not read .*package\.json \(EACCES\)/);
  });
});
