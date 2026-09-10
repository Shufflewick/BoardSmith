import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { resolveUserPath } from './user-path.js';

describe('resolveUserPath', () => {
  it('honours an absolute path as given', () => {
    // The whole reason this function exists (#239): `join` would have produced
    // '/repo/root/tmp/out' and written inside the repository.
    expect(resolveUserPath('/repo/root', '/tmp/out')).toBe('/tmp/out');
  });

  it('resolves a relative path against the base', () => {
    expect(resolveUserPath('/repo/root', 'dist')).toBe('/repo/root/dist');
    expect(resolveUserPath('/repo/root', '.boardsmith/tarballs')).toBe(
      '/repo/root/.boardsmith/tarballs',
    );
  });

  it('resolves a path that climbs out of the base', () => {
    expect(resolveUserPath('/repo/root', '../sibling/out')).toBe('/repo/sibling/out');
  });

  it('normalises redundant segments', () => {
    expect(resolveUserPath('/repo/root', './out/./sub/')).toBe('/repo/root/out/sub');
  });

  it('expands a leading ~ to the home directory', () => {
    // A shell expands `~` before we ever see it, but a quoted argument and a
    // value read out of a config file both arrive literal. Resolving those
    // against the base would create a directory actually named `~`.
    expect(resolveUserPath('/repo/root', '~/out')).toBe(join(homedir(), 'out'));
    expect(resolveUserPath('/repo/root', '~')).toBe(homedir());
  });

  it('leaves a ~ that is part of a name alone', () => {
    // `~cache` is a real directory name, not a home reference.
    expect(resolveUserPath('/repo/root', '~cache')).toBe('/repo/root/~cache');
  });

  it('rejects an empty path rather than silently returning the base', () => {
    // An empty `--out-dir ''` would otherwise resolve to the base and write
    // into the invocation directory, which is the failure mode of #239 again.
    expect(() => resolveUserPath('/repo/root', '')).toThrow(/empty/i);
    expect(() => resolveUserPath('/repo/root', '   ')).toThrow(/empty/i);
  });
});
