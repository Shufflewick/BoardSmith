/**
 * Running the real `boardsmith verify` the way a user does, for the suites that check its result.
 */
import { once } from 'node:events';
import { CLI_BIN, REPO_ROOT, type SpawnResult } from '../spawn-cli.test-helper.js';
import { readVerifyResult, type VerifyResult, type VerifyCheckResult } from '../lib/verify-result.js';
import { git } from '../lib/verify-result.test-helper.js';
import { Started } from '../lib/started-processes.js';

/**
 * How long verify's checks get to report, from when it starts them, before the run counts as stalled.
 * A hang guard, not a budget: it leaves a 180s test time to scaffold first and to stop what the run started.
 */
const CHECKS_STALL_MS = 110_000;

/** The line verify prints as it starts its checks, naming them. */
const CHECKS_STARTED = /boardsmith verify: running (.+) side by side/;

/** The checks a run's stdout names as started and has not yet reported done or failed. */
function unreported(stdout: string): string {
  const started = CHECKS_STARTED.exec(stdout)![1].split(', ');
  const reported = new Set([...stdout.matchAll(/boardsmith verify: (\w+) (?:done|failed)/g)].map((m) => m[1]));
  const pending = started.filter((name) => !reported.has(name));
  return pending.length === 0 ? 'none; every check had reported' : pending.join(', ');
}

/**
 * Runs the real `boardsmith verify` with `args` in its own process group. A run whose checks have
 * not all reported `stallAfterMs` after it started them is stopped with everything it started, and
 * fails the test naming the checks it had not reported and its output so far (#1779).
 */
async function runVerifyCli(args: string[], stallAfterMs: number): Promise<SpawnResult> {
  const started = new Started();
  // vitest 3 sets FORCE_TTY="" in its workers, and the vitest a CLI starts reads any FORCE_TTY as a terminal and prints colours.
  const { child } = started.spawn([CLI_BIN, 'verify', ...args], REPO_ROOT, { FORCE_TTY: undefined }, { ownGroup: true });
  let stdout = '';
  let stderr = '';
  let stalled = false;
  let guard: NodeJS.Timeout | undefined;
  child.stdout!.on('data', (chunk: string) => {
    stdout += chunk;
    guard ??= CHECKS_STARTED.test(stdout)
      ? setTimeout(() => {
          stalled = true;
          started.stopAll().catch(() => {});
        }, stallAfterMs)
      : undefined;
  });
  child.stderr!.on('data', (chunk: string) => (stderr += chunk));
  let code: number | null = null;
  let stopProblem = '';
  try {
    [code] = (await once(child, 'close')) as [number | null];
  } finally {
    clearTimeout(guard);
    try {
      await started.finish(async () => {});
    } catch (error) {
      if (!stalled) throw error;
      stopProblem = ` Stopping it failed too: ${(error as Error).message}`;
    }
  }
  if (stalled) {
    throw new Error(
      `\`boardsmith verify\` was still running its checks ${stallAfterMs / 1000}s after it started them, ` +
        `so it was stopped with everything it started.${stopProblem} Checks that had not reported: ${unreported(stdout)}.\n` +
        `Its stdout so far:\n${stdout}\nIts stderr so far:\n${stderr}`,
    );
  }
  return { code: code ?? 1, stdout, stderr };
}

/**
 * Runs the real `boardsmith verify` in `dir` with `args`, and reads the result it wrote for HEAD.
 * Its checks get `stallAfterMs` to report before the run is stopped and the test fails naming them.
 */
export async function verifyAsAUser(dir: string, args: string[] = [], { stallAfterMs = CHECKS_STALL_MS } = {}) {
  const run = await runVerifyCli([...args, '--project', dir], stallAfterMs);
  const head = git(dir, 'rev-parse', 'HEAD').trim();
  return { run, result: (await readVerifyResult(dir, head)) as VerifyResult };
}

/** The check named `name` in `result`. */
export const check = (result: VerifyResult, name: string): VerifyCheckResult => result.checks.find((c) => c.name === name)!;
