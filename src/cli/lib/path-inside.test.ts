import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { isSameOrInside, mayBeSameOrInside } from './path-inside.js';

const project = join('/', 'game');

describe.each([
  ['isSameOrInside', isSameOrInside],
  ['mayBeSameOrInside', mayBeSameOrInside],
])('%s (#1053)', (_name, inside) => {
  it('holds the folder itself and anything under it', () => {
    expect(inside(join(project, 'src', 'rules'), join(project, 'src', 'rules'))).toBe(true);
    expect(inside(join(project, 'src', 'rules'), join(project, 'src', 'rules', 'a', 'b.ts'))).toBe(true);
    expect(inside(`${join(project, 'src')}/`, join(project, 'src', 'a.ts'))).toBe(true);
    expect(inside('/', join(project, 'a.ts'))).toBe(true);
  });

  it('does not hold a sibling folder whose name starts with the folder\'s', () => {
    expect(inside(join(project, 'src', 'rules'), join(project, 'src', 'rules-old', 'a.ts'))).toBe(false);
    expect(inside('src', 'srcs/a.ts')).toBe(false);
  });

  it('does not hold the folder above it, a sibling, or a path that climbs out', () => {
    expect(inside(join(project, 'src'), project)).toBe(false);
    expect(inside(join(project, 'src'), join(project, 'tests', 'a.ts'))).toBe(false);
    expect(inside('src', 'src/../tests/a.ts')).toBe(false);
    expect(inside('src', '../src/a.ts')).toBe(false);
  });

  it('does not hold a sibling because the folder\'s own name is not ASCII', () => {
    expect(inside(join('/', 'a', 'vidéo'), join('/', 'a', 'other', 'x.ts'))).toBe(false);
  });
});

describe('isSameOrInside compares names exactly, since "inside" there skips or trusts a path (#1053)', () => {
  it.skipIf(process.platform === 'win32')('does not hold a folder whose name differs only in letter case', () => {
    expect(isSameOrInside(join('/', 'a', 'Game'), join('/', 'a', 'game', 'x.ts'))).toBe(false);
  });

  it('does not hold a non-ASCII name it cannot be sure of', () => {
    expect(isSameOrInside(join('/', 'a', 'other'), join('/', 'a', 'vidéo', 'x.ts'))).toBe(false);
    expect(isSameOrInside('src', 'ſrc/a.ts')).toBe(false);
  });
});

describe('mayBeSameOrInside holds what a case-insensitive disk may open there (#841, #1053)', () => {
  it('holds a candidate spelled in other letter case', () => {
    expect(mayBeSameOrInside(join(project, 'src', 'rules'), join(project, 'SRC', 'Rules', 'a.ts'))).toBe(true);
    expect(mayBeSameOrInside('src/', 'SRC/rules/a.ts')).toBe(true);
  });

  it('counts a candidate segment with a non-ASCII letter as the same name, since no fold of it is sure', () => {
    expect(mayBeSameOrInside('src/', 'ſrc/rules/a.ts')).toBe(true);
  });
});
