import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { pruneStaleTarballs } from './pack.js';

/**
 * `pruneStaleTarballs` DELETES files inside a consumer's repository, so its
 * blast radius is the thing worth testing: it must remove previous vendorings
 * of the packages being replaced, and nothing else.
 */
describe('pruneStaleTarballs', () => {
  let vendorDir: string;

  beforeEach(() => {
    vendorDir = mkdtempSync(join(tmpdir(), 'bs-vendor-'));
  });

  afterEach(() => {
    rmSync(vendorDir, { recursive: true, force: true });
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
