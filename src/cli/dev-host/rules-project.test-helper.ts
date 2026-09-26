/**
 * A GAME PROJECT'S RULES ON DISK, the way an author has them: a `src/rules`
 * directory holding `index.ts`, and the directory under `.boardsmith` that
 * `boardsmith dev` bundles into. Saving is the one move an author makes to it.
 *
 * Shared by the table road's tests (`table-host.test-helper.ts`) and the world
 * road's (`world-rules-reload.test.ts`), which each load it with their own
 * road's loader.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { commandBuildDir } from '../lib/project-paths.js';

export function rulesProject(prefix: string, source: string) {
  const dir = tempTree(prefix);
  const rulesPath = join(dir, 'src', 'rules');
  mkdirSync(rulesPath, { recursive: true });
  const tempDir = commandBuildDir(dir, 'dev');
  mkdirSync(tempDir, { recursive: true });
  const save = (rules: string) => writeFileSync(join(rulesPath, 'index.ts'), rules);
  save(source);
  return { rulesPath, tempDir, save };
}

/**
 * The error `load` fails with. For an edit a test needs to NOT build; one that
 * builds is a broken test, and says so.
 */
export async function buildFailure(load: () => Promise<unknown>): Promise<Error> {
  return load().then(
    () => {
      throw new Error('The broken edit built, so it cannot stand for an edit that does not.');
    },
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );
}
