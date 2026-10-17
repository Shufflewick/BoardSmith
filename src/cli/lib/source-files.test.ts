/**
 * The CLI's one recursive file walk (#1048). Each command used to carry its own,
 * and they disagreed on which folders to skip and how to treat links, so a check
 * could silently miss part of a game.
 */
import { describe, it, expect } from 'vitest';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
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

  it('counts a link to a file as that file, and never follows a link to a folder, so a loop cannot trap it', () => {
    const dir = tree(['real/a.ts', 'outside/b.ts']);
    symlinkSync(join(dir, 'real', 'a.ts'), join(dir, 'real', 'linked.ts'));
    symlinkSync(join(dir, 'outside'), join(dir, 'real', 'folder-link'));
    symlinkSync(dir, join(dir, 'real', 'loop'));
    symlinkSync(join(dir, 'gone.ts'), join(dir, 'real', 'dangling.ts'));
    expect(rel(dir, listFiles(join(dir, 'real'), { sourceTree: false }))).toEqual(['real/a.ts', 'real/linked.ts']);
  });
});

describe('collectSourceFiles', () => {
  it('takes every game source extension and can be narrowed to a subset', () => {
    const dir = tree(['a.ts', 'b.tsx', 'c.mts', 'd.vue', 'e.json']);
    expect(rel(dir, collectSourceFiles(dir))).toEqual(['a.ts', 'b.tsx', 'c.mts', 'd.vue']);
    expect(rel(dir, collectSourceFiles(dir, ['ts', 'tsx']))).toEqual(['a.ts', 'b.tsx']);
  });
});
