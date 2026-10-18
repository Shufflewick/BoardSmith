/**
 * The CLI's one recursive file walk (#1048). Each command used to carry its own,
 * and they disagreed on which folders to skip and how to treat links, so a check
 * could silently miss part of a game.
 */
import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { collectSourceFiles, listFiles } from './source-files.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

function tree(files: string[]): string {
  const dir = tempTree('bs-list-files-');
  for (const rel of files) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), '');
  }
  return dir;
}

const rel = (dir: string, files: string[]) => files.map((f) => relative(dir, f)).sort();

describe('listFiles', () => {
  const FILES = ['a.ts', 'sub/b.test.ts', 'node_modules/c.ts', '.cache/d.ts', '.env.ts', 'types.d.ts', 'sub/e.d.mts', 'f.css'];

  it('in a source tree, skips node_modules, dot entries and declaration files', () => {
    const dir = tree(FILES);
    expect(rel(dir, listFiles(dir, { sourceTree: true }))).toEqual(['a.ts', 'f.css', 'sub/b.test.ts']);
  });

  it('outside a source tree, keeps every file', () => {
    const dir = tree(FILES);
    expect(rel(dir, listFiles(dir, { sourceTree: false }))).toEqual([...FILES].sort());
  });

  it('keeps only names ending in one of the given suffixes', () => {
    const dir = tree(FILES);
    expect(rel(dir, listFiles(dir, { sourceTree: true, suffixes: ['.test.ts', '.css'] }))).toEqual(['f.css', 'sub/b.test.ts']);
  });

  it('gives no files for a folder that does not exist', () => {
    expect(listFiles(join(tempTree('bs-list-files-'), 'missing'), { sourceTree: false })).toEqual([]);
  });

  it('counts a link to a file as that file, and in a source tree skips a link to nothing', () => {
    const dir = tree(['real/a.ts']);
    symlinkSync(join(dir, 'real', 'a.ts'), join(dir, 'real', 'linked.ts'));
    symlinkSync(join(dir, 'gone.ts'), join(dir, 'real', 'dangling.ts'));
    expect(rel(dir, listFiles(join(dir, 'real'), { sourceTree: true }))).toEqual(['real/a.ts', 'real/linked.ts']);
  });

  // The build follows a folder link, so a source-tree check that skipped it would miss bundled code (#1112).
  it.each([true, false])('stops on a link to a folder, loops included, when sourceTree is %s', (sourceTree) => {
    const dir = tree(['real/a.ts']);
    symlinkSync(dir, join(dir, 'real', 'loop'));
    expect(() => listFiles(join(dir, 'real'), { sourceTree })).toThrow(`${join(dir, 'real', 'loop')} is a link to a folder`);
  });

  // Outside a source tree every file is wanted, so a link the walk cannot follow would silently drop files (#1048).
  it.each([
    ['a folder', (dir: string) => join(dir, 'outside')],
    ['nothing', (dir: string) => join(dir, 'gone')],
  ])('outside a source tree, stops on a link to %s, naming it, even when its name has no wanted suffix', (what, target) => {
    const dir = tree(['real/a.js', 'outside/b.png']);
    symlinkSync(target(dir), join(dir, 'real', 'cards'));
    expect(() => listFiles(join(dir, 'real'), { sourceTree: false, suffixes: ['.js'] })).toThrow(
      `${join(dir, 'real', 'cards')} is a link to ${what}`,
    );
  });

  it('names a path that is a file, not a folder', () => {
    const dir = tree(['tests']);
    expect(() => listFiles(join(dir, 'tests'), { sourceTree: true })).toThrow(`${join(dir, 'tests')} is a file, not a folder.`);
  });

  it('names a folder it has no permission to read', () => {
    const dir = tree(['locked/a.ts']);
    chmodSync(join(dir, 'locked'), 0o000);
    try {
      expect(() => listFiles(dir, { sourceTree: true })).toThrow(`${join(dir, 'locked')} cannot be read: permission denied.`);
    } finally {
      chmodSync(join(dir, 'locked'), 0o755);
    }
  });
});

describe('collectSourceFiles', () => {
  it('takes every game source extension and can be narrowed to a subset', () => {
    const dir = tree(['a.ts', 'b.tsx', 'c.mts', 'd.vue', 'e.json']);
    expect(rel(dir, collectSourceFiles(dir))).toEqual(['a.ts', 'b.tsx', 'c.mts', 'd.vue']);
    expect(rel(dir, collectSourceFiles(dir, ['ts', 'tsx']))).toEqual(['a.ts', 'b.tsx']);
  });
});
