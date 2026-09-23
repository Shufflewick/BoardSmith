/**
 * ONE WAY TO ASK `vue-tsc` WHAT IT FOUND, for the two contract gates that ask.
 *
 * `public-typecheck.test.ts` compiles a game's view of our public entry points;
 * `dev-host-typecheck.test.ts` compiles the development host in a sandbox that
 * holds only what we ship. They differ in WHERE they run and WHAT they blame a
 * failure on, and in nothing else -- so the run, and the rule for what counts
 * as an error line, live here rather than twice.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { INSTALLED_MODULES } from '../testing/installed-modules.test-helper.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The compiler both gates drive, named once so a sandbox can quote it. */
export const VUE_TSC = join(INSTALLED_MODULES, 'vue-tsc/bin/vue-tsc.js');

/**
 * Compile `project` from `cwd` and return the error lines, in order.
 *
 * The exit code is deliberately not consulted: what a gate asserts is an EMPTY
 * LIST, because the list is what its failure message has to print.
 */
export function vueTscErrors(cwd: string, project: string): string[] {
  const run = spawnSync(process.execPath, [VUE_TSC, '--noEmit', '-p', project], {
    cwd,
    encoding: 'utf8',
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  return output.split('\n').filter((line) => /error TS\d+:/.test(line));
}
