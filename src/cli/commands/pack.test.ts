import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { packAll, packOutputDir, pruneStaleTarballs, readContractRevision } from './pack.js';
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

  /** The `PackageInfo` for a fixture package, at contract revision `revision`. */
  const info = (name: string, path: string, revision = 7) => ({ name, path, version: '1.0.0', revision });

  it('writes the tarball into an absolute output directory it has to create', () => {
    const pkgDir = fixturePackage('bs-fixture-ok');
    const outDir = join(root, 'elsewhere', 'nested', 'tarballs');

    const [result] = packAll([info('bs-fixture-ok', pkgDir)], outDir);

    expect(existsSync(join(outDir, result.tarball))).toBe(true);
    // The source tree keeps nothing: `npm pack` writes into the package
    // directory and the tarball is moved out of it.
    expect(readdirSync(pkgDir).filter((f) => f.endsWith('.tgz'))).toEqual([]);
  });

  it('names the version after the contract revision and the packed content (#434)', () => {
    const pkgDir = fixturePackage('bs-fixture-named');

    const [result] = packAll([info('bs-fixture-named', pkgDir, 115)], join(root, 'out'));

    // One prerelease identifier, not two: a dot before the hash would make an
    // all-digit hash with a leading zero an invalid semver version.
    expect(result.packVersion).toMatch(/^1\.0\.0-r115-[0-9a-f]{12}$/);
    expect(result.tarball).toBe(`bs-fixture-named-${result.packVersion}.tgz`);
  });

  it('packs the same tree twice into byte-identical tarballs with the same name (#434)', () => {
    // A re-vendor of unchanged sources has to be a no-op in the consumer, so
    // nothing about a pack may depend on when it ran.
    const pkgDir = fixturePackage('bs-fixture-twice');

    const [first] = packAll([info('bs-fixture-twice', pkgDir)], join(root, 'first'));
    utimesSync(join(pkgDir, 'index.js'), new Date(2030, 0, 1), new Date(2030, 0, 1));
    const [second] = packAll([info('bs-fixture-twice', pkgDir)], join(root, 'second'));

    expect(second.tarball).toBe(first.tarball);
    expect(
      readFileSync(join(root, 'second', second.tarball)).equals(readFileSync(join(root, 'first', first.tarball))),
    ).toBe(true);
  });

  it('changes the name when any packed file changes (#434)', () => {
    const pkgDir = fixturePackage('bs-fixture-edited');

    const [before] = packAll([info('bs-fixture-edited', pkgDir)], join(root, 'before'));
    writeFileSync(join(pkgDir, 'index.js'), 'module.exports = { changed: true };\n');
    const [after] = packAll([info('bs-fixture-edited', pkgDir)], join(root, 'after'));

    expect(after.tarball).not.toBe(before.tarball);
  });

  it('changes the name when only the contract revision changes (#434)', () => {
    const pkgDir = fixturePackage('bs-fixture-revision');

    const [r7] = packAll([info('bs-fixture-revision', pkgDir, 7)], join(root, 'r7'));
    const [r8] = packAll([info('bs-fixture-revision', pkgDir, 8)], join(root, 'r8'));

    expect(r8.tarball).not.toBe(r7.tarball);
  });

  it('keeps the name when a file npm does not pack changes (#434)', () => {
    // The hash covers what ships, by npm's own file list, so editing a file
    // `files` leaves out cannot make an unchanged engine look new.
    const pkgDir = fixturePackage('bs-fixture-unpacked', { files: ['index.js'] });
    writeFileSync(join(pkgDir, 'notes.txt'), 'first\n');

    const [before] = packAll([info('bs-fixture-unpacked', pkgDir)], join(root, 'before'));
    writeFileSync(join(pkgDir, 'notes.txt'), 'second\n');
    const [after] = packAll([info('bs-fixture-unpacked', pkgDir)], join(root, 'after'));

    expect(after.tarball).toBe(before.tarball);
  });

  it('restores the package version it rewrote', () => {
    const pkgDir = fixturePackage('bs-fixture-restore');

    packAll([info('bs-fixture-restore', pkgDir)], join(root, 'out'));

    // The pack version is written into package.json only for the duration of
    // `npm pack`; a pack must not leave the source tree's version rewritten.
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
      packAll([info('bs-fixture-first', good), info('bs-fixture-broken', bad)], outDir),
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

    expect(() => packAll([info('bs-fixture-preexisting', bad)], outDir)).toThrow();

    expect(readdirSync(outDir)).toEqual(['KEEP.md']);
  });

  it('removes the tarball npm pack produced when it cannot be moved', () => {
    // A directory standing where the tarball has to land makes the move fail
    // after `npm pack` has already written into the package directory. Without
    // cleanup that tarball stays in the source tree, which is what dirtied the
    // checkout in #239. The name is content-derived, so a first pack finds it.
    const pkgDir = fixturePackage('bs-fixture-blocked');
    const [probe] = packAll([info('bs-fixture-blocked', pkgDir)], join(root, 'probe'));
    const outDir = join(root, 'blocked');
    mkdirSync(join(outDir, probe.tarball), { recursive: true });

    expect(() => packAll([info('bs-fixture-blocked', pkgDir)], outDir)).toThrow();

    expect(readdirSync(pkgDir).filter((f) => f.endsWith('.tgz'))).toEqual([]);
  });
});

/**
 * The revision in the pack version is read from the tree being packed, not
 * from the CLI doing the packing, which can be an older build (#434).
 */
describe('readContractRevision', () => {
  let root: string;

  beforeEach(() => {
    root = tempTree('bs-pack-revision-');
    mkdirSync(join(root, 'src', 'contract'), { recursive: true });
  });

  const writeContract = (contract: unknown) =>
    writeFileSync(join(root, 'src', 'contract', 'engine-contract.json'), JSON.stringify(contract));

  it('reads the revision the tree records', () => {
    writeContract({ revision: 115, history: [] });
    expect(readContractRevision(root)).toBe(115);
  });

  it('refuses a tree with no contract, naming where it looked', () => {
    expect(() => readContractRevision(root)).toThrow(/No engine contract at .*engine-contract\.json/);
  });

  it('refuses a contract whose revision is not a positive integer', () => {
    writeContract({ revision: '115' });
    expect(() => readContractRevision(root)).toThrow(/has no valid revision \(found "115"\)/);
  });
});
