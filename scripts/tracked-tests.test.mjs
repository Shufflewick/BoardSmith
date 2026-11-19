/** The guard scans' tracked-file lister reads git's NUL-separated list, so a name git would quote is listed as written (#1729). */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../src/testing/temp-tree.test-helper.ts';
import { trackedFiles } from './tracked-tests.test-helper.mjs';

describe('trackedFiles', () => {
  it('lists a tracked name holding a quote and a tab as written, and leaves out an untracked one', () => {
    const root = tempTree('bs-tracked-files-');
    mkdirSync(join(root, 'src'));
    const names = ['src/plain.ts', 'src/say "hi".ts', 'src/tab\there.ts'];
    for (const name of [...names, 'src/scratch.ts']) writeFileSync(join(root, name), '');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', ...names], { cwd: root });
    expect(trackedFiles(['src'], root).sort()).toEqual([...names].sort());
  });
});
