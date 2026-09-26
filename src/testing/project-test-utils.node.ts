/**
 * The project's own `@vue/test-utils`, resolved with Node (#389).
 *
 * Only `dom-leak.ts` loads this, through `#testing/project-test-utils`, and a
 * compiler sees `project-test-utils.d.ts` in its place (#411): read that file
 * before importing Node-only code anywhere else under `src/testing`.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { importProjectTestUtils as Declared } from '#testing/project-test-utils';

export const importProjectTestUtils: typeof Declared = async () => {
  const project = process.cwd();
  let entry: string;
  try {
    entry = createRequire(join(project, 'package.json')).resolve('@vue/test-utils');
  } catch {
    throw new Error(
      `renderAsSeat mounts with your project's own @vue/test-utils, so a board renders on the same Vue ` +
        `its components import, and none is installed in ${project}. ` +
        'Run `npm install --save-dev @vue/test-utils` there, then run the tests again.',
    );
  }
  return (await import(pathToFileURL(entry).href)) as typeof import('@vue/test-utils');
};
