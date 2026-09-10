import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
/**
 * `resolveUserPath` is not just a convenience: it is meant to be the ONLY way
 * a CLI command turns a path a user typed into an absolute one, because the two
 * defects #239 found were both a `join(cwd, <option value>)` that read as
 * correct. A gate is the only thing that stops the third one.
 */
describe('the CLI has one way to resolve a user-supplied path', () => {
  const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...sourceFiles(full));
        continue;
      }
      if (!entry.endsWith('.ts')) continue;
      if (entry.endsWith('.test.ts') || entry.endsWith('.test-helper.ts')) continue;
      out.push(full);
    }
    return out;
  }

  const files = sourceFiles(cliDir).map((path) => ({ path, text: readFileSync(path, 'utf-8') }));

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never joins an output directory onto the invocation directory', () => {
    // `join(cwd, outDir)` is the exact shape of #239, and it occurred twice --
    // once in `pack`, once in `build` -- because it reads as obviously right.
    const offenders = files
      .filter(({ text }) => /join\(\s*(?:cwd|process\.cwd\(\))\s*,\s*out(?:Dir|putDir)\b/.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('expands a leading ~ in exactly one place', () => {
    // A second hand-rolled expansion is how the two spellings drift apart.
    const offenders = files
      .filter(({ path }) => !path.endsWith(join('lib', 'user-path.ts')))
      .filter(({ text }) => /\/\^~/.test(text) || text.includes("startsWith('~')"))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
