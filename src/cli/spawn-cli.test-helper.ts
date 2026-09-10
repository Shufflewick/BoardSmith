/**
 * Spawning the REAL CLI entry point, for the suites that must observe it as a
 * user's shell would (#238).
 *
 * `cli.test.ts` and `cli-conformance-commands.test.ts` both need this and both
 * had their own copy of it, comments included -- 54 duplicated lines, the
 * largest clone group between two test files in the repo.
 *
 * Spawning is deliberate rather than incidental in both. `cli.ts`'s top-level
 * `try { await program.parseAsync() } catch { process.exitCode = 1 }` is only
 * exercised by a real process exit, and `program.parseAsync()` does not await
 * action handlers the way an in-process call would, so asserting on
 * `process.exitCode` after an in-process call tests something weaker than the
 * contract these suites pin.
 *
 * ## Why a spawning suite needs a raised timeout
 *
 * A spawn boots Node, loads tsx, and type-strips the whole command tree, which
 * under full-suite parallelism can exceed Vitest's 5s default on its own. That
 * default turned latency into a flaky assertion about nothing -- these suites
 * assert what the CLI REGISTERS, never how fast it starts. So each of them
 * raises it with `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`.
 * That call stays in the test file rather than moving here, because it
 * configures the file that runs it; what moved is this explanation, which was
 * the copied part.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);

/** This file lives at src/cli/, so the repo root is two levels up. */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The real entry point, the one `npx boardsmith` runs. */
const CLI_BIN = join(REPO_ROOT, 'bin', 'boardsmith.js');

/** What a spawn reports back: everything the shell would have seen. */
interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn the real CLI and resolve with its exit code, stdout and stderr.
 *
 * It never throws on a non-zero exit, because a non-zero exit is exactly what
 * the tool-failure cases assert on; `execFile`'s promisified rejection carries
 * `code`/`stdout`/`stderr` on the error object.
 */
export async function spawnCli(args: string[], cwd: string = REPO_ROOT): Promise<SpawnResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_BIN, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
