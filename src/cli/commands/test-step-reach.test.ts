import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { GLOBAL_SETUP_MARK, readReach } from './test-step-reach.js';

/** A record folder holding `records`, each a test file's project path and the project paths its worker loaded. */
async function reachOf(records: Record<string, string[]>, testFiles: string[], marks: string[] = []) {
  const root = tempTree('bs-reach-');
  const project = join(root, 'game');
  const reachDir = join(root, 'reach');
  await fs.mkdir(reachDir);
  for (const [test, loaded] of Object.entries(records)) {
    await fs.writeFile(join(reachDir, encodeURIComponent(join(project, test))), loaded.map((p) => (p === '*' ? p : join(project, p)) + '\n').join(''));
  }
  for (const mark of marks) await fs.writeFile(join(reachDir, mark), '');
  const reach = await readReach(reachDir, project, testFiles);
  return { project, reach };
}

describe('readReach (#981)', () => {
  it('names only the test files whose record loads the file', async () => {
    const { project, reach } = await reachOf({
      'tests/a.test.ts': ['tests/a.test.ts', 'src/x.ts', 'src/a.ts'],
      'tests/b.test.ts': ['tests/b.test.ts', 'src/b.ts'],
    }, ['tests/a.test.ts', 'tests/b.test.ts']);
    expect(reach.testsLoading('src/a.ts')).toEqual([join(project, 'tests/a.test.ts')]);
    expect(reach.testsLoading('src/orphan.ts')).toEqual([]);
    expect(reach.unrecorded).toEqual([]);
  });

  it('runs for every file a test file with no record, one whose record does not name it, and one that shared a worker', async () => {
    const { project, reach } = await reachOf({
      'tests/a.test.ts': ['tests/a.test.ts', 'src/a.ts'],
      'tests/elsewhere.test.ts': ['src/b.ts'],
      'tests/shared.test.ts': ['*'],
    }, ['tests/a.test.ts', 'tests/missing.test.ts', 'tests/elsewhere.test.ts', 'tests/shared.test.ts']);
    expect(reach.unrecorded).toEqual(['tests/missing.test.ts', 'tests/elsewhere.test.ts', 'tests/shared.test.ts']);
    expect(reach.testsLoading('src/orphan.ts')).toEqual(['missing', 'elsewhere', 'shared'].map((n) => join(project, `tests/${n}.test.ts`)));
  });

  it('runs every test file for every file when a global setup ran', async () => {
    const { reach } = await reachOf({ 'tests/a.test.ts': ['tests/a.test.ts', 'src/a.ts'] }, ['tests/a.test.ts'], [GLOBAL_SETUP_MARK]);
    expect(reach.unrecorded).toEqual(['tests/a.test.ts']);
    expect(reach.testsLoading('src/orphan.ts')).toHaveLength(1);
  });
});
