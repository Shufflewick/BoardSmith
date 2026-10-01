/**
 * Running the real `boardsmith verify` the way a user does, for the suites that check its result.
 */
import { spawnCli } from '../spawn-cli.test-helper.js';
import { readVerifyResult, type VerifyResult, type VerifyCheckResult } from '../lib/verify-result.js';
import { git } from '../lib/verify-result.test-helper.js';

/** Runs the real `boardsmith verify` in `dir` with `args`, and reads the result it wrote for HEAD. */
export async function verifyAsAUser(dir: string, args: string[] = []) {
  const run = await spawnCli(['verify', ...args, '--project', dir]);
  const head = git(dir, 'rev-parse', 'HEAD').trim();
  return { run, result: (await readVerifyResult(dir, head)) as VerifyResult };
}

/** The check named `name` in `result`. */
export const check = (result: VerifyResult, name: string): VerifyCheckResult => result.checks.find((c) => c.name === name)!;
