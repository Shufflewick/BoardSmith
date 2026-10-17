import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

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

/** A minimal npm package `npm pack` will accept, in its own directory under `root`. */
function fixturePackage(root: string, name: string, extra: Record<string, unknown> = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', ...extra }, null, 2) + '\n',
  );
  writeFileSync(join(dir, 'index.js'), 'module.exports = {};\n');
  // pack locks in the checkout's git directory (#744).
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

/** The `PackageInfo` for a fixture package, at contract revision `revision`. */
const info = (name: string, path: string, revision = 7) => ({ name, path, version: '1.0.0', revision });

/** The error a pack threw, or undefined when it did not throw. */
const thrown = (pending: Promise<unknown>): Promise<unknown> => pending.then(() => undefined, (error: unknown) => error);

// #1086: every pack runs real `npm pack`, seconds each on a busy machine, so
// each test's packs run here, while the file is collected and no test timeout
// applies, and the tests only read what they left behind.
const [ok, named, twice, edited, revision, unpacked, restored, failed, preexisting, blocked] = await Promise.all([
  (async () => {
    const root = tempTree('bs-pack-all-');
    const pkgDir = fixturePackage(root, 'bs-fixture-ok');
    const outDir = join(root, 'elsewhere', 'nested', 'tarballs');
    const [result] = await packAll([info('bs-fixture-ok', pkgDir)], outDir);
    return { pkgDir, outDir, result };
  })(),
  (async () => {
    const root = tempTree('bs-pack-all-');
    const pkgDir = fixturePackage(root, 'bs-fixture-named');
    const [result] = await packAll([info('bs-fixture-named', pkgDir, 115)], join(root, 'out'));
    return { result };
  })(),
  (async () => {
    // A re-vendor of unchanged sources has to be a no-op in the consumer, so
    // nothing about a pack may depend on when it ran.
    const root = tempTree('bs-pack-all-');
    const pkgDir = fixturePackage(root, 'bs-fixture-twice');
    const [first] = await packAll([info('bs-fixture-twice', pkgDir)], join(root, 'first'));
    utimesSync(join(pkgDir, 'index.js'), new Date(2030, 0, 1), new Date(2030, 0, 1));
    const [second] = await packAll([info('bs-fixture-twice', pkgDir)], join(root, 'second'));
    return { root, first, second };
  })(),
  (async () => {
    const root = tempTree('bs-pack-all-');
    const pkgDir = fixturePackage(root, 'bs-fixture-edited');
    const [before] = await packAll([info('bs-fixture-edited', pkgDir)], join(root, 'before'));
    writeFileSync(join(pkgDir, 'index.js'), 'module.exports = { changed: true };\n');
    const [after] = await packAll([info('bs-fixture-edited', pkgDir)], join(root, 'after'));
    return { before, after };
  })(),
  (async () => {
    const root = tempTree('bs-pack-all-');
    const pkgDir = fixturePackage(root, 'bs-fixture-revision');
    const [r7] = await packAll([info('bs-fixture-revision', pkgDir, 7)], join(root, 'r7'));
    const [r8] = await packAll([info('bs-fixture-revision', pkgDir, 8)], join(root, 'r8'));
    return { r7, r8 };
  })(),
  (async () => {
    // The hash covers what ships, by npm's own file list, so editing a file
    // `files` leaves out cannot make an unchanged engine look new.
    const root = tempTree('bs-pack-all-');
    const pkgDir = fixturePackage(root, 'bs-fixture-unpacked', { files: ['index.js'] });
    writeFileSync(join(pkgDir, 'notes.txt'), 'first\n');
    const [before] = await packAll([info('bs-fixture-unpacked', pkgDir)], join(root, 'before'));
    writeFileSync(join(pkgDir, 'notes.txt'), 'second\n');
    const [after] = await packAll([info('bs-fixture-unpacked', pkgDir)], join(root, 'after'));
    return { before, after };
  })(),
  (async () => {
    const root = tempTree('bs-pack-all-');
    const pkgDir = fixturePackage(root, 'bs-fixture-restore');
    await packAll([info('bs-fixture-restore', pkgDir)], join(root, 'out'));
    return { pkgDir };
  })(),
  (async () => {
    // `prepack` runs inside `npm pack`, so a failing one is a real pack
    // failure and not a simulated one.
    const root = tempTree('bs-pack-all-');
    const good = fixturePackage(root, 'bs-fixture-first');
    const bad = fixturePackage(root, 'bs-fixture-broken', { scripts: { prepack: 'exit 1' } });
    const outDir = join(root, 'created-by-pack', 'tarballs');
    const error = await thrown(packAll([info('bs-fixture-first', good), info('bs-fixture-broken', bad)], outDir));
    return { root, good, bad, error };
  })(),
  (async () => {
    // The directory is the caller's, not pack's. A failure may empty out what
    // pack put in it, but must not delete a directory pack did not create.
    const root = tempTree('bs-pack-all-');
    const bad = fixturePackage(root, 'bs-fixture-preexisting', { scripts: { prepack: 'exit 1' } });
    const outDir = join(root, 'mine');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'KEEP.md'), 'mine\n');
    const error = await thrown(packAll([info('bs-fixture-preexisting', bad)], outDir));
    return { outDir, error };
  })(),
  (async () => {
    // A directory standing where the tarball has to land makes the move fail
    // after `npm pack` has already written into the package directory. Without
    // cleanup that tarball stays in the source tree, which is what dirtied the
    // checkout in #239. The name is content-derived, so a first pack finds it.
    const root = tempTree('bs-pack-all-');
    const pkgDir = fixturePackage(root, 'bs-fixture-blocked');
    const [probe] = await packAll([info('bs-fixture-blocked', pkgDir)], join(root, 'probe'));
    const outDir = join(root, 'blocked');
    mkdirSync(join(outDir, probe.tarball), { recursive: true });
    const error = await thrown(packAll([info('bs-fixture-blocked', pkgDir)], outDir));
    return { pkgDir, error };
  })(),
]);

/**
 * `packAll` owns the tarballs and every directory it had to create for them,
 * so a failure can leave neither a stray `npm pack` output in the source tree
 * (`*.tgz` is not gitignored) nor a half-filled output directory.
 */
describe('packAll', () => {
  it('writes the tarball into an absolute output directory it has to create', () => {
    expect(existsSync(join(ok.outDir, ok.result.tarball))).toBe(true);
    // The source tree keeps nothing: `npm pack` writes into the package
    // directory and the tarball is moved out of it.
    expect(readdirSync(ok.pkgDir).filter((f) => f.endsWith('.tgz'))).toEqual([]);
  });

  it('names the version after the contract revision and the packed content (#434)', () => {
    // One prerelease identifier, not two: a dot before the hash would make an
    // all-digit hash with a leading zero an invalid semver version.
    expect(named.result.packVersion).toMatch(/^1\.0\.0-r115-[0-9a-f]{12}$/);
    expect(named.result.tarball).toBe(`bs-fixture-named-${named.result.packVersion}.tgz`);
  });

  it('packs the same tree twice into byte-identical tarballs with the same name (#434)', () => {
    const { root, first, second } = twice;
    expect(second.tarball).toBe(first.tarball);
    expect(
      readFileSync(join(root, 'second', second.tarball)).equals(readFileSync(join(root, 'first', first.tarball))),
    ).toBe(true);
  });

  it('changes the name when any packed file changes (#434)', () => {
    expect(edited.after.tarball).not.toBe(edited.before.tarball);
  });

  it('changes the name when only the contract revision changes (#434)', () => {
    expect(revision.r8.tarball).not.toBe(revision.r7.tarball);
  });

  it('keeps the name when a file npm does not pack changes (#434)', () => {
    expect(unpacked.after.tarball).toBe(unpacked.before.tarball);
  });

  it('restores the package version it rewrote', () => {
    // The pack version is written into package.json only for the duration of
    // `npm pack`; a pack must not leave the source tree's version rewritten.
    const pkgJson = JSON.parse(readFileSync(join(restored.pkgDir, 'package.json'), 'utf-8'));
    expect(pkgJson.version).toBe('1.0.0');
  });

  it('removes the output directory it created when a pack fails', () => {
    expect(failed.error).toBeInstanceOf(Error);
    expect((failed.error as Error).message).toMatch(/bs-fixture-broken/);

    // Nothing survives: not the directory tree pack made, not the tarball it
    // had already written into it.
    expect(existsSync(join(failed.root, 'created-by-pack'))).toBe(false);
    expect(readdirSync(failed.good).filter((f) => f.endsWith('.tgz'))).toEqual([]);
    expect(readdirSync(failed.bad).filter((f) => f.endsWith('.tgz'))).toEqual([]);
  });

  it('leaves an output directory that already existed', () => {
    expect(preexisting.error).toBeInstanceOf(Error);
    expect(readdirSync(preexisting.outDir)).toEqual(['KEEP.md']);
  });

  it('removes the tarball npm pack produced when it cannot be moved', () => {
    expect(blocked.error).toBeInstanceOf(Error);
    expect(readdirSync(blocked.pkgDir).filter((f) => f.endsWith('.tgz'))).toEqual([]);
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
