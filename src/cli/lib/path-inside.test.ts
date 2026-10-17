import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { isSameOrInside } from './path-inside.js';

const project = join('/', 'game');

describe('isSameOrInside (#1053)', () => {
  it('holds the folder itself and anything under it', () => {
    expect(isSameOrInside(join(project, 'src', 'rules'), join(project, 'src', 'rules'))).toBe(true);
    expect(isSameOrInside(join(project, 'src', 'rules'), join(project, 'src', 'rules', 'a', 'b.ts'))).toBe(true);
    expect(isSameOrInside(`${join(project, 'src')}/`, join(project, 'src', 'a.ts'))).toBe(true);
    expect(isSameOrInside('/', join(project, 'a.ts'))).toBe(true);
  });

  it('does not hold a sibling folder whose name starts with the folder\'s', () => {
    expect(isSameOrInside(join(project, 'src', 'rules'), join(project, 'src', 'rules-old', 'a.ts'))).toBe(false);
    expect(isSameOrInside('src', 'srcs/a.ts')).toBe(false);
  });

  it('does not hold the folder above it, a sibling, or a path that climbs out', () => {
    expect(isSameOrInside(join(project, 'src'), project)).toBe(false);
    expect(isSameOrInside(join(project, 'src'), join(project, 'tests', 'a.ts'))).toBe(false);
    expect(isSameOrInside('src', 'src/../tests/a.ts')).toBe(false);
    expect(isSameOrInside('src', '../src/a.ts')).toBe(false);
  });

  it('holds a path spelled in other letter case, which a case-insensitive disk opens as the same folder', () => {
    expect(isSameOrInside(join(project, 'src', 'rules'), join(project, 'SRC', 'Rules', 'a.ts'))).toBe(true);
    expect(isSameOrInside('SRC/', 'src/rules/a.ts')).toBe(true);
  });

  it('counts a segment with a non-ASCII letter as the same name, since no fold of it is sure (#841)', () => {
    expect(isSameOrInside('src/', 'ſrc/rules/a.ts')).toBe(true);
    expect(isSameOrInside('ſrc/', 'src/rules/a.ts')).toBe(true);
    expect(isSameOrInside(join('/', 'Users', 'José', 'game', 'src'), join('/', 'Users', 'José', 'game', 'tests', 'a.ts'))).toBe(false);
  });
});
