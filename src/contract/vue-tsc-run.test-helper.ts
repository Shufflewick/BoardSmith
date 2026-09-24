/**
 * ONE WAY TO ASK `vue-tsc` WHAT IT FOUND, for the two contract gates that ask.
 *
 * `dev-host-typecheck.test.ts` compiles the development host, and
 * `dice-typecheck.test.ts` the dice entry point, each in a sandbox that holds
 * only what we ship. They differ in WHAT they compile and WHAT they blame a
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

/** What `vueTscErrorLines` reads from a finished `spawnSync`. */
interface VueTscRun {
  readonly status: number | null;
  readonly stdout: string | null;
  readonly stderr: string | null;
  readonly error?: Error;
}

/**
 * The error lines of a finished run, in order.
 *
 * A run that failed without a single `error TS` line did not type-check
 * anything -- the compiler was missing, or crashed -- so it throws rather than
 * hand a gate the empty list that gate reads as clean (#287).
 */
export function vueTscErrorLines(run: VueTscRun): string[] {
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const errors = output.split('\n').filter((line) => /error TS\d+:/.test(line));
  if (run.error || (run.status !== 0 && errors.length === 0)) {
    throw new Error(
      `vue-tsc did not run, so nothing was type-checked. Repeat with \`node ${VUE_TSC} --noEmit\` ` +
        `to see why.\n${run.error ? `${run.error.message}\n` : ''}${output}`,
    );
  }
  return errors;
}

/**
 * Compile `project` from `cwd` and return the error lines, in order.
 *
 * The exit code is deliberately not consulted: what a gate asserts is an EMPTY
 * LIST, because the list is what its failure message has to print.
 */
export function vueTscErrors(cwd: string, project: string): string[] {
  return vueTscErrorLines(
    spawnSync(process.execPath, [VUE_TSC, '--noEmit', '-p', project], { cwd, encoding: 'utf8' }),
  );
}
