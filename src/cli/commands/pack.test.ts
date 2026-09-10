import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { packAll, packOutputDir, pruneStaleTarballs } from './pack.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/**
 * `pruneStaleTarballs` DELETES files inside a consumer's repository, so its
 * blast radius is the thing worth testing: it must remove previous vendorings
 * of the packages being replaced, and nothing else.
 */
describe('pruneStaleTarballs', () => {
  let vendorDir: string;

  beforeEach(() => {
    vendorDir = tempTree('bs-vendor-');
  });

  const write = (name: string) => writeFileSync(join(vendorDir, name), 'x');

  it('removes a previous vendoring of the same package', () => {
    write('boardsmith-0.0.1-20260101000000.tgz');
    write('boardsmith-0.0.1-20260202000000.tgz');

    const removed = pruneStaleTarballs(
      vendorDir,
      new Set(['boardsmith-0.0.1-20260202000000.tgz']),
      ['boardsmith'],
    );

    expect(removed).toEqual(['boardsmith-0.0.1-20260101000000.tgz']);
    expect(readdirSync(vendorDir)).toEqual(['boardsmith-0.0.1-20260202000000.tgz']);
  });

  it('never removes the tarball just written', () => {
    write('boardsmith-0.0.1-20260202000000.tgz');

    pruneStaleTarballs(vendorDir, new Set(['boardsmith-0.0.1-20260202000000.tgz']), ['boardsmith']);

    expect(readdirSync(vendorDir)).toEqual(['boardsmith-0.0.1-20260202000000.tgz']);
  });

  it('leaves tarballs belonging to other packages alone', () => {
    // A consumer's vendor/ is theirs, not ours. Packing boardsmith must not
    // touch a tarball we were never asked to replace.
    write('some-other-dep-1.2.3.tgz');
    write('boardsmith-0.0.1-20260101000000.tgz');

    pruneStaleTarballs(vendorDir, new Set(['boardsmith-0.0.1-20260202000000.tgz']), ['boardsmith']);

    expect(readdirSync(vendorDir)).toEqual(['some-other-dep-1.2.3.tgz']);
  });

  it('leaves non-tarball files alone', () => {
    write('README.md');
    write('boardsmith-0.0.1-20260101000000.tgz');

    pruneStaleTarballs(vendorDir, new Set([]), ['boardsmith']);

    expect(readdirSync(vendorDir)).toEqual(['README.md']);
  });

  it('is a no-op when the vendor directory does not exist yet', () => {
    const absent = join(vendorDir, 'nope');
    expect(() => pruneStaleTarballs(absent, new Set([]), ['boardsmith'])).not.toThrow();
    expect(pruneStaleTarballs(absent, new Set([]), ['boardsmith'])).toEqual([]);
  });

  it('does not treat a package name as a prefix of a different package', () => {
    // Packing `boardsmith` must not delete `boardsmith-extras-1.0.0.tgz`.
    // A bare startsWith('boardsmith-') matches it, which is why the version
    // segment has to be anchored to a digit.
    write('boardsmith-extras-1.0.0.tgz');
    write('boardsmith-0.0.1-20260101000000.tgz');

    const removed = pruneStaleTarballs(vendorDir, new Set([]), ['boardsmith']);

    expect(removed).toEqual(['boardsmith-0.0.1-20260101000000.tgz']);
    expect(readdirSync(vendorDir)).toEqual(['boardsmith-extras-1.0.0.tgz']);
  });

  it('handles a scoped package name without treating it as a regex', () => {
    write('scope-pkg-1.0.0.tgz');

    const removed = pruneStaleTarballs(vendorDir, new Set([]), ['@scope/pkg']);

    expect(removed).toEqual(['scope-pkg-1.0.0.tgz']);
  });
});

/**
 * Where `--out-dir` points (#239).
 *
 * `join(cwd, outDir)` appended an absolute `--out-dir` to the repository root,
 * so `pack --out-dir /private/tmp/scratch` wrote the tarball to
 * `<repo>/private/tmp/scratch/` and left an untracked directory behind. That
 * dirty checkout is what ShufflewickPub's `vendor:boardsmith` refuses to pack
 * from, so an ignored flag broke the whole vendoring chain downstream.
 */
describe('packOutputDir', () => {
  it('honours an absolute --out-dir', () => {
    expect(packOutputDir('/repo/root', '/private/tmp/scratch/packcheck')).toBe(
      '/private/tmp/scratch/packcheck',
    );
  });

  it('resolves a relative --out-dir against the invocation directory', () => {
    expect(packOutputDir('/repo/root', 'out/tarballs')).toBe('/repo/root/out/tarballs');
  });

  it('defaults to .boardsmith/tarballs under the invocation directory', () => {
    expect(packOutputDir('/repo/root', undefined)).toBe('/repo/root/.boardsmith/tarballs');
  });
});

/**
 * `packAll` owns the tarballs and every directory it had to create for them,
 * so a failure can leave neither a stray `npm pack` output in the source tree
 * (`*.tgz` is not gitignored) nor a half-filled output directory.
 */
describe('packAll', () => {
  let root: string;

  beforeEach(() => {
    root = tempTree('bs-pack-all-');
  });

  /** A minimal npm package `npm pack` will accept. */
  function fixturePackage(name: string, extra: Record<string, unknown> = {}): string {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name, version: '1.0.0', ...extra }, null, 2) + '\n',
    );
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};\n');
    return dir;
  }

  it('writes the tarball into an absolute output directory it has to create', () => {
    const pkgDir = fixturePackage('bs-fixture-ok');
    const outDir = join(root, 'elsewhere', 'nested', 'tarballs');

    const results = packAll(
      [{ name: 'bs-fixture-ok', path: pkgDir, version: '1.0.0' }],
      outDir,
      '20260910000000',
    );

    expect(results).toEqual([
      {
        name: 'bs-fixture-ok',
        tarball: 'bs-fixture-ok-1.0.0-20260910000000.tgz',
        timestampVersion: '1.0.0-20260910000000',
      },
    ]);
    expect(existsSync(join(outDir, 'bs-fixture-ok-1.0.0-20260910000000.tgz'))).toBe(true);
    // The source tree keeps nothing: `npm pack` writes into the package
    // directory and the tarball is moved out of it.
    expect(readdirSync(pkgDir).filter((f) => f.endsWith('.tgz'))).toEqual([]);
  });

  it('restores the package version it rewrote', () => {
    const pkgDir = fixturePackage('bs-fixture-restore');

    packAll(
      [{ name: 'bs-fixture-restore', path: pkgDir, version: '1.0.0' }],
      join(root, 'out'),
      '20260910000000',
    );

    // The timestamp version is written into package.json only for the duration
    // of `npm pack`; a pack must not leave the source tree's version rewritten.
    const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));
    expect(pkgJson.version).toBe('1.0.0');
  });

  it('removes the output directory it created when a pack fails', () => {
    // `prepack` runs inside `npm pack`, so a failing one is a real pack
    // failure and not a simulated one.
    const good = fixturePackage('bs-fixture-first');
    const bad = fixturePackage('bs-fixture-broken', { scripts: { prepack: 'exit 1' } });
    const outDir = join(root, 'created-by-pack', 'tarballs');

    expect(() =>
      packAll(
        [
          { name: 'bs-fixture-first', path: good, version: '1.0.0' },
          { name: 'bs-fixture-broken', path: bad, version: '1.0.0' },
        ],
        outDir,
        '20260910000000',
      ),
    ).toThrow(/bs-fixture-broken/);

    // Nothing survives: not the directory tree pack made, not the tarball it
    // had already written into it.
    expect(existsSync(join(root, 'created-by-pack'))).toBe(false);
    expect(readdirSync(good).filter((f) => f.endsWith('.tgz'))).toEqual([]);
    expect(readdirSync(bad).filter((f) => f.endsWith('.tgz'))).toEqual([]);
  });

  it('leaves an output directory that already existed', () => {
    // The directory is the caller's, not pack's. A failure may empty out what
    // pack put in it, but must not delete a directory pack did not create.
    const bad = fixturePackage('bs-fixture-preexisting', { scripts: { prepack: 'exit 1' } });
    const outDir = join(root, 'mine');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'KEEP.md'), 'mine\n');

    expect(() =>
      packAll([{ name: 'bs-fixture-preexisting', path: bad, version: '1.0.0' }], outDir, '20260910000000'),
    ).toThrow();

    expect(readdirSync(outDir)).toEqual(['KEEP.md']);
  });

  it('removes the tarball npm pack produced when it cannot be moved', () => {
    // A directory standing where the tarball has to land makes the move fail
    // after `npm pack` has already written into the package directory. Without
    // cleanup that tarball stays in the source tree, which is what dirtied the
    // checkout in #239.
    const pkgDir = fixturePackage('bs-fixture-blocked');
    const outDir = join(root, 'blocked');
    mkdirSync(join(outDir, 'bs-fixture-blocked-1.0.0-20260910000000.tgz'), { recursive: true });

    expect(() =>
      packAll([{ name: 'bs-fixture-blocked', path: pkgDir, version: '1.0.0' }], outDir, '20260910000000'),
    ).toThrow();

    expect(readdirSync(pkgDir).filter((f) => f.endsWith('.tgz'))).toEqual([]);
  });
});
