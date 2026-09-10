/**
 * WHAT `boardsmith/<x>` RESOLVES TO IN A MONOREPO CHECKOUT, AND WHO DECIDES.
 *
 * The two loaders that answer this -- esbuild's, for a project's rules, and
 * Vite's, for its UI -- used to read a hand-written map of specifier to `src/`
 * subdirectory. A hand-written copy of a list that already exists drifts, and
 * this one had: eight of the package's nineteen exports, missing
 * `boardsmith/world` among six others. In monorepo context a world project's
 * rules could not resolve the module that makes it a world, and the failure
 * arrives as rules that will not load with nothing naming why.
 *
 * `package.json`'s `exports` is the definition -- Node enforces it for every
 * standalone project -- so the map is derived from it and these tests hold the
 * derivation to it. What they cannot be replaced by: a test that lists the
 * entries itself, which would be the same hand-written copy one level removed.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { boardsmithSourceEntries, cliMonorepoRoot } from './game-runtime.js';
import { monorepoBoardsmithResolvePlugin } from './dev-server.js';
import { PLATFORM_ENTRYPOINTS } from '../../contract/fingerprint.js';

/** Every subpath this package declares, read the same way Node reads it. */
function declaredSpecifiers(): string[] {
  const manifest = JSON.parse(readFileSync(join(cliMonorepoRoot, 'package.json'), 'utf-8')) as {
    exports: Record<string, unknown>;
  };
  return Object.keys(manifest.exports).map((subpath) =>
    subpath === '.' ? 'boardsmith' : `boardsmith/${subpath.replace(/^\.\//, '')}`,
  );
}

/** The Vite plugin's own answer for one specifier. */
function viteResolves(source: string): string | null {
  const { resolveId } = monorepoBoardsmithResolvePlugin();
  const hook = resolveId as unknown as (this: unknown, source: string) => string | null;
  return hook.call(null, source);
}

describe('boardsmith/* resolution is derived from the package exports', () => {
  it('serves every entrypoint the package declares', () => {
    const entries = boardsmithSourceEntries();
    const missing = declaredSpecifiers().filter((specifier) => !entries.has(specifier));
    expect(missing).toEqual([]);
  });

  it('points every one of them at a file that is really there', () => {
    const absent = [...boardsmithSourceEntries()]
      .filter(([, file]) => !existsSync(file))
      .map(([specifier, file]) => `${specifier} -> ${file}`);
    expect(absent).toEqual([]);
  });

  it('resolves boardsmith/world, the entry whose absence was the trap', () => {
    expect(boardsmithSourceEntries().get('boardsmith/world')).toBe(
      resolve(cliMonorepoRoot, 'src/world/index.ts'),
    );
  });

  it('resolves a nested subpath the old layout guess could not reach', () => {
    // `boardsmith/ui/auto-ui` is its own export. The previous code rebuilt it
    // as `src/ui/src/components/auto-ui/index.ts` -- a layout this repo has
    // never had -- and so resolved it to nothing.
    expect(boardsmithSourceEntries().get('boardsmith/ui/auto-ui')).toBe(
      resolve(cliMonorepoRoot, 'src/ui/components/auto-ui/index.ts'),
    );
  });

  it('resolves the CSS exports, which are files rather than modules', () => {
    expect(boardsmithSourceEntries().get('boardsmith/ui/animation/drag-drop.css')).toBe(
      resolve(cliMonorepoRoot, 'src/ui/animation/drag-drop.css'),
    );
  });

  it('invents nothing for a specifier the package does not export', () => {
    // A typo has to stay a typo: resolving it to some plausible file inside the
    // library turns "no such entrypoint" into a missing module deep in a build.
    expect(boardsmithSourceEntries().has('boardsmith/wrold')).toBe(false);
    expect(viteResolves('boardsmith/wrold')).toBeNull();
  });

  it('answers the same thing in both loaders, since a game imports through both', () => {
    // The rules go through esbuild and the UI through Vite. Two answers for one
    // specifier is a project whose rules and board are different builds of the
    // library, which is the failure the shared derivation exists to forbid.
    for (const specifier of declaredSpecifiers()) {
      expect(viteResolves(specifier)).toBe(boardsmithSourceEntries().get(specifier));
    }
  });

  it('leaves a specifier that is not the library alone', () => {
    expect(viteResolves('vue')).toBeNull();
  });

  /**
   * The two lists are NOT the same set and are not merged: `PLATFORM_ENTRYPOINTS`
   * is what the CONTRACT fingerprints -- five modules the platform itself can
   * reach, deliberately excluding the UI, the CLI, the trainer and the testing
   * kit, which ship inside a game's bundle and cannot cause engine skew. The
   * exports are what a GAME may import, which is the larger set.
   *
   * What must hold between them is one direction: a platform entrypoint the
   * package does not export is one the executor's `sandboxedRequire` hands to
   * game rules under a name nothing can resolve.
   */
  it('exports every entrypoint the contract fingerprints', () => {
    const entries = boardsmithSourceEntries();
    const unexported = PLATFORM_ENTRYPOINTS.map((entry) => entry.specifier).filter(
      (specifier) => !entries.has(specifier),
    );
    expect(unexported).toEqual([]);
  });
});
