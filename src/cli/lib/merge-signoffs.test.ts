import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { MERGE_SIGNOFFS_MD, designPath } from './project-paths.js';
import { readMergeSignoffs } from './merge-signoffs.js';

describe('readMergeSignoffs', () => {
  it('reads a project that has no record yet as having none', async () => {
    expect(await readMergeSignoffs(tempTree('bs-merge-signoffs-'))).toEqual([]);
  });

  it('refuses a record it cannot read rather than reading it as absent', async () => {
    const dir = tempTree('bs-merge-signoffs-');
    await fs.mkdir(designPath(dir, MERGE_SIGNOFFS_MD), { recursive: true });
    await expect(readMergeSignoffs(dir)).rejects.toThrow(`Could not read ${designPath(dir, MERGE_SIGNOFFS_MD)} (EISDIR)`);
  });
});
