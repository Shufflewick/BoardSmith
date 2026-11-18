import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { MERGE_SIGNOFFS_MD, designPath } from './project-paths.js';
import { appendMergeSignoffs, readMergeSignoffs } from './merge-signoffs.js';

describe('readMergeSignoffs', () => {
  it('reads a project that has no record yet as having none', async () => {
    expect(await readMergeSignoffs(tempTree('bs-merge-signoffs-'))).toEqual([]);
  });

  it('refuses a record it cannot read rather than reading it as absent', async () => {
    const dir = tempTree('bs-merge-signoffs-');
    await fs.mkdir(designPath(dir, MERGE_SIGNOFFS_MD), { recursive: true });
    await expect(readMergeSignoffs(dir)).rejects.toThrow(`Could not read ${designPath(dir, MERGE_SIGNOFFS_MD)} (EISDIR)`);
  });

  it('refuses an entry whose Content line holds only spaces (#1696)', async () => {
    const dir = tempTree('bs-merge-signoffs-');
    const text = appendMergeSignoffs(undefined, [{ path: 'src/a.ts', content: 'x', chunks: ['deal'], merge: 'abc', when: '2026-11-18' }]);
    await fs.mkdir(designPath(dir), { recursive: true });
    await fs.writeFile(designPath(dir, MERGE_SIGNOFFS_MD), text.replace('- Content: x', '- Content:   '));
    await expect(readMergeSignoffs(dir)).rejects.toThrow('missing a Content, Chunks, Merge or When line');
  });
});
