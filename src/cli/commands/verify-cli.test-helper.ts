/**
 * Running the real `boardsmith verify` the way a user does, for the suites that check its result.
 */
import { once } from 'node:events';
import { getCurrentTest } from 'vitest/suite';
import { CLI_BIN, REPO_ROOT, type SpawnResult } from '../spawn-cli.test-helper.js';
import { readVerifyResult, type VerifyResult, type VerifyCheckResult } from '../lib/verify-result.js';
import { git } from '../lib/verify-result.test-helper.js';
import { Started } from '../lib/started-processes.js';

/** How long before its test's deadline a run still going is stopped, leaving time to stop what it started and say why. */
const STOP_BEFORE_DEADLINE_MS = 20_000;

/** The checks a run's stdout names as started and has not yet reported done or failed. */
function unreported(stdout: string): string {
  const started = /boardsmith verify: running (.+) side by side/.exec(stdout)?.[1].split(', ');
  if (started === undefined) return 'none, as it had not started them';
  const reported = new Set([...stdout.matchAll(/boardsmith verify: (\w+) (?:done|failed)/g)].map((m) => m[1]));
  return started.filter((name) => !reported.has(name)).join(', ');
}

/**
 * Runs the real `boardsmith verify` with `args` in its own process group. A run still going
 * `STOP_BEFORE_DEADLINE_MS` before the test's deadline is stopped with everything it started, and
 * fails the test naming the checks it had not reported and its output so far (#1779).
 */
async function runVerifyCli(args: string[]): Promise<SpawnResult> {
  const test = getCurrentTest();
  const startTime = test?.result?.startTime;
  if (test === undefined || startTime === undefined) throw new Error('verifyAsAUser runs `boardsmith verify` for a test; call it inside one.');
  const started = new Started();
  // vitest 3 sets FORCE_TTY="" in its workers, and the vitest a CLI starts reads any FORCE_TTY as a terminal and prints colours.
  const { child } = started.spawn([CLI_BIN, 'verify', ...args], REPO_ROOT, { FORCE_TTY: undefined }, { ownGroup: true });
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (chunk: string) => (stdout += chunk));
  child.stderr!.on('data', (chunk: string) => (stderr += chunk));
  let stalled = false;
  const guard =
    test.timeout > 0
      ? setTimeout(() => {
          stalled = true;
          started.stopAll().catch(() => {});
        }, startTime + test.timeout - STOP_BEFORE_DEADLINE_MS - Date.now())
      : undefined;
  let code: number | null;
  try {
    [code] = (await once(child, 'close')) as [number | null];
  } finally {
    clearTimeout(guard);
    await started.finish(async () => {});
  }
  if (stalled) {
    throw new Error(
      `\`boardsmith verify\` was still running ${STOP_BEFORE_DEADLINE_MS / 1000}s before this test's ${test.timeout / 1000}s limit, ` +
        `so it was stopped with everything it started. Checks that had not reported: ${unreported(stdout)}.\n` +
        `Its stdout so far:\n${stdout}\nIts stderr so far:\n${stderr}`,
    );
  }
  return { code: code ?? 1, stdout, stderr };
}

/** Runs the real `boardsmith verify` in `dir` with `args`, and reads the result it wrote for HEAD. */
export async function verifyAsAUser(dir: string, args: string[] = []) {
  const run = await runVerifyCli([...args, '--project', dir]);
  const head = git(dir, 'rev-parse', 'HEAD').trim();
  return { run, result: (await readVerifyResult(dir, head)) as VerifyResult };
}

/** The check named `name` in `result`. */
export const check = (result: VerifyResult, name: string): VerifyCheckResult => result.checks.find((c) => c.name === name)!;
