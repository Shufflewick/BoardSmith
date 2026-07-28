/**
 * `drift-check.ts` — CHECK-05: the code-drift check.
 *
 * For each chunk, diffs its `## Build Manifest` file list against the commit recorded in its
 * `## Verified Commit Hash`, and reports every chunk whose code moved since a human approved it
 * (172-CONTEXT.md decision 9). Works retroactively on every existing chunk — there is no
 * close-time write this check depends on.
 *
 * THIS IS THE FIRST COMMAND IN THE CODEBASE TO SHELL OUT TO GIT AS A SUBPROCESS. It sets the
 * convention Phase 173 will copy:
 *   - `execFile` with an argv array, never `exec`/`execSync` with a shell string. `init.ts` uses
 *     `execSync` for a FIXED, hard-coded command (`git init`); this module's hash comes from a
 *     hand-editable `CHUNK.md`, so that pattern is deliberately NOT copied here.
 *   - `cwd` is mandatory and explicit on every invocation, and is always the resolved GAME
 *     project directory — never BoardSmith's own repo. The wrong `cwd` silently diffs the wrong
 *     repository (T-172-03).
 *   - A hash pulled from a `CHUNK.md` is untrusted input flowing into a git argv. `execFile`
 *     already prevents shell interpretation, but an argv element beginning with `-` is still read
 *     by git as a FLAG (e.g. `--upload-pack=touch /tmp/pwned`) — the `/^[0-9a-f]{7,40}$/` hash
 *     regex below is what closes that hole, and it runs BEFORE git is ever invoked (T-172-01).
 *
 * Zero rulebook or source access anywhere in this module (source-free by construction, same as
 * `trace-check.ts`) — the only external process this file spawns is `git`.
 *
 * READ-ONLY. No mutating `fs` call and no mutating git subcommand (only `diff`, `rev-parse`,
 * `merge-base`) appears anywhere in this file's body. Pinned directly by a before/after
 * whole-project byte-hash test, the same T-171-19 class `chunk-provenance.ts:706-714` and
 * `trace-check.ts` pin.
 */

import { execFile } from 'node:child_process';

/**
 * A hand-written promisified wrapper, NOT `promisify(execFile)`. Node's `execFile` carries a
 * `util.promisify.custom` implementation that `promisify()` prefers when present; a test-time
 * mock of `execFile` (`vi.fn(actual.execFile)`) does not carry that symbol over, which silently
 * changes `promisify`'s resolution shape from `{ stdout, stderr }` to a positional `[stdout,
 * stderr]` array. Calling the callback form directly here keeps behavior identical whether
 * `execFile` is the real implementation or a test mock wrapping it.
 */
function execFileAsync(
  cmd: string,
  args: string[],
  options: { cwd: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

/**
 * Closes T-172-01: a hand-edited `## Verified Commit Hash` is untrusted input reaching a git
 * argv. This is checked BEFORE any git invocation — an argv element beginning with `-` (e.g.
 * `--upload-pack=touch /tmp/pwned`) is still read by git as a flag even though `execFile`'s argv
 * form prevents shell interpretation. Only lower-case hex, 7–40 characters, ever reaches git.
 */
const HASH_SHAPE = /^[0-9a-f]{7,40}$/;

/** Sentinel returned instead of throwing when a hash cannot be resolved into a diff. */
export const UNRESOLVABLE = 'unresolvable' as const;

// -------------------------------------------------------------------------------------------
// Git plumbing (Task 1)
// -------------------------------------------------------------------------------------------

/**
 * `git diff --name-only <hash> HEAD`, run with an explicit `cwd` and a validated hash.
 *
 * Returns the `UNRESOLVABLE` sentinel — never throws — when the hash is not hash-shaped, or when
 * git cannot resolve it (unknown commit, shallow clone missing history, etc.). The caller
 * (`driftCheckCommand`) is responsible for treating `UNRESOLVABLE` as `drift-unknown`, not as a
 * tool failure: a bad hash in one chunk must never abort the whole run.
 */
export async function diffedFilesSince(
  projectDir: string,
  hash: string,
): Promise<string[] | typeof UNRESOLVABLE> {
  if (!HASH_SHAPE.test(hash)) return UNRESOLVABLE;

  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', hash, 'HEAD'], {
      cwd: projectDir,
    });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return UNRESOLVABLE;
  }
}

/**
 * `git merge-base --is-ancestor <hash> HEAD` (exit 0 = yes, non-zero = no or unresolvable).
 * Distinguishes "hash exists but is not an ancestor of HEAD" from "hash unresolvable" — both map
 * to `drift-unknown` in the caller, but with a different `detail`. Never hand-parses `git log`.
 */
async function isAncestorOfHead(projectDir: string, hash: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', hash, 'HEAD'], { cwd: projectDir });
    return true;
  } catch {
    return false;
  }
}

async function resolveHead(projectDir: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectDir });
  return stdout.trim();
}

/**
 * Preflight per T-172-03: confirms `projectDir` is inside a git repository before any diff work
 * starts. `cwd` on this call is `projectDir` itself — if it is not a repo (or git is not
 * installed), git fails and this throws an actionable error naming the directory and the
 * `--project` flag, rather than silently falling back to running in BoardSmith's own repo.
 */
async function assertGitRepo(projectDir: string): Promise<void> {
  try {
    await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: projectDir });
  } catch {
    throw new Error(
      `${projectDir} is not a git repository (or git is not installed).\n` +
        `drift-check needs git history to diff each chunk's Build Manifest files against — run it ` +
        `from inside a game project's git repo, or pass --project <dir>.`,
    );
  }
}
