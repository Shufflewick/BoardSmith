import { constants as fsConstants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { gitOutput, gitSucceeds } from './git-output.js';
import { DESIGN_DIR, RULEBOOK_DIR } from './project-paths.js';
import { readIfExists } from './read-if-exists.js';

/**
 * The `pre-commit` hook `boardsmith init` installs into every scaffolded game project.
 *
 * WHY A HOOK
 *
 * Thirteen mechanisms were tried to get an ingest session to run the synthesis step that fills
 * `design/rulebook/INDEX.md`'s gaps section and moves presentation notes off the `Derived (p.N):`
 * prefix. Prose, a template, a pointer, a handshake token, a delegated subagent, re-read gates,
 * a CLI command, that command as an item in a sequence whose other items always run, and finally
 * that command reduced to a single invocation — every one of them was skipped on live runs, often
 * from a file the session had just read.
 *
 * Exactly one thing has ever worked: `boardsmith init` refusing to run without an explicit
 * `--rulebook` / `--without-rulebook` decision. A command that FAILS gets acted on; everything
 * else gets skipped.
 *
 * There is no forced command after transcription to attach the synthesis to — so it attaches to
 * something the session does not choose at all. The bs- build protocol commits at every step, so
 * a `pre-commit` hook runs the synthesis automatically on the first commit after slices exist.
 * The harness runs it, not the model.
 *
 * WHAT THIS HOOK DOES NOT COVER (found by the 2026-07-28 human gate, 170-PROOF-RUN-2.md)
 *
 * "The build protocol commits at every step" is true of `/bs-build-chunk` and false of
 * `/bs-ingest-rules`, which has no commit in it at all. A real ingest run therefore ENDS with
 * this hook never having fired: gaps unswept, nothing relabelled. `/bs-build-chunk` then reads
 * `design/rulebook/INDEX.md` during investigate, before its own first commit, so the first chunk is
 * planned against the unsynthesized index.
 *
 * Two things close that window, and neither replaces this hook:
 *   - `## Open Rules Gaps` is fenced as machine-owned, so an orchestrator cannot fill it by hand
 *     (which is what happened — 2 entries written against 5 slice markers). Worst case is now a
 *     visibly-empty `_None._`, not a plausible-looking wrong answer.
 *   - `boardsmith ingest-check` repairs and then exits non-zero, and `/bs-build-chunk` Step 0
 *     runs it. The non-zero exit is the point: it forces a re-read of the repaired index.
 *
 * This hook stays as the backstop for every commit after that.
 *
 * DESIGN NOTES
 *
 * - It FIXES and STAGES rather than failing the commit. A hook that blocks commits would fight
 *   the build protocol; one that quietly makes the artifacts correct just removes the failure.
 *   It stages only the files `ingest-gaps --print-changed` names, never a slice the designer is
 *   still editing (#851).
 * - It is a no-op before slices exist (the scaffold commit, any pre-transcription commit) and
 *   idempotent afterwards, so it is safe on every commit rather than only the right one.
 * - Every failure path is non-fatal. A game project must never become uncommittable because a
 *   convenience hook could not resolve the CLI.
 */
export const INGEST_PRE_COMMIT_HOOK = `#!/bin/sh
# BoardSmith ingest synthesis — installed by \`boardsmith init\`.
#
# Fills ${DESIGN_DIR}/${RULEBOOK_DIR}/INDEX.md's "## Open Rules Gaps" section from the slice files and
# relabels Derived (p.N): lines that are pure presentation description as Visual (p.N):.
#
# This runs here, rather than as a step in the bs- ingest skill, because thirteen attempts to
# have the ingest session invoke it were all skipped on live runs. A hook is not chosen by the
# model. See src/cli/lib/ingest-hook.ts for the full history.
#
# Safe on every commit: a no-op until rulebook slices exist, idempotent afterwards, and never
# fatal — a project must not become uncommittable because this could not run.

set -u

RULEBOOK="${DESIGN_DIR}/${RULEBOOK_DIR}"

# Nothing to synthesize until transcription has produced slices and the index scaffold exists.
[ -f "$RULEBOOK/INDEX.md" ] || exit 0
if ! ls "$RULEBOOK"/*.md >/dev/null 2>&1; then exit 0
fi
SLICES=$(ls "$RULEBOOK"/*.md 2>/dev/null | grep -v 'INDEX.md$' | grep -v '00-visual-survey.md$' | head -1)
[ -n "$SLICES" ] || exit 0

CHANGED=$(mktemp) || exit 0
if ! npx --no-install boardsmith ingest-gaps --print-changed >"$CHANGED" 2>/dev/null; then
  rm -f "$CHANGED"
  echo "boardsmith: ingest synthesis skipped (could not run 'boardsmith ingest-gaps')." >&2
  echo "boardsmith: run it manually before relying on $RULEBOOK/INDEX.md." >&2
  exit 0
fi

# Include the corrections in THIS commit rather than leaving them dirty afterwards. Only the files
# ingest-gaps changed: a slice the designer is still editing must not be swept into the commit.
[ -s "$CHANGED" ] && xargs -0 git add -- <"$CHANGED" >/dev/null 2>&1
rm -f "$CHANGED"

exit 0
`;

/**
 * Where a project's ingest hook stands: what `init` and `doctor` both decide from. `path` names the
 * hook for messages, relative to the project where it can be; `absolute` is the file itself.
 */
export type IngestHook =
  | { state: 'no-git' }
  | { state: 'git-failed'; reason: string }
  | HookAt<'outside' | 'in-project' | 'missing' | 'current' | 'stale' | 'not-executable' | 'foreign' | 'unreadable'>;

/** One member per state, so a check of `state` narrows to it. */
type HookAt<State> = State extends string ? { state: State; path: string; absolute: string } : never;

/** The project's own repository, not one an inherited GIT_DIR, GIT_WORK_TREE or GIT_COMMON_DIR names (#1301). */
function ownRepositoryEnv(): NodeJS.ProcessEnv {
  const { GIT_DIR: _dir, GIT_WORK_TREE: _workTree, GIT_COMMON_DIR: _commonDir, ...env } = process.env;
  return env;
}

/**
 * The state of the `pre-commit` hook git runs for this project. Git names the path, so
 * `core.hooksPath` and a linked worktree's shared hooks are followed (#1186).
 * A folder with no `.git` of its own is `no-git`: a hook found above it would run from another top folder.
 * A `.git` git cannot read is `git-failed`, with git's own words.
 * A hook path outside both the project and its git folder is `outside`: a global `core.hooksPath`
 * is shared by every repository on the machine, so it is not ours to write. One inside the project
 * that git does not ignore is `in-project`: a hook written there would be committed (#1301).
 * A hook carrying the marker is ours; any other is the designer's. Ours without the execute bit is
 * `not-executable`, whatever its version: git skips it, printing only a hint (#1187).
 */
export async function ingestHookState(projectPath: string): Promise<IngestHook> {
  const place = await hookPlace(projectPath);
  if (place.state !== 'found') return place;
  const { path, absolute } = place;
  let existing: string | undefined;
  try {
    existing = await readIfExists(absolute, (p) => fs.readFile(p, 'utf-8'));
  } catch {
    return { state: 'unreadable', path, absolute };
  }
  if (existing === undefined) return { state: 'missing', path, absolute };
  if (!existing.includes('BoardSmith ingest synthesis')) return { state: 'foreign', path, absolute };
  if (!(await isExecutable(absolute))) return { state: 'not-executable', path, absolute };
  return { state: existing === INGEST_PRE_COMMIT_HOOK ? 'current' : 'stale', path, absolute };
}

/** Where git runs the project's pre-commit hook from, or the state that says it is not ours to look at. */
async function hookPlace(
  projectPath: string,
): Promise<{ state: 'found'; path: string; absolute: string } | Extract<IngestHook, { state: 'no-git' | 'git-failed' | 'outside' | 'in-project' }>> {
  try {
    await fs.access(join(projectPath, '.git'));
  } catch {
    return { state: 'no-git' };
  }
  // Git names real paths, so the project's must be real too, or every relative path runs through `..` (#1301).
  const project = await fs.realpath(projectPath);
  const env = ownRepositoryEnv();
  let commonDir: string;
  let hookPath: string;
  try {
    [commonDir, hookPath] = (await gitOutput(project, ['rev-parse', '--git-common-dir', '--git-path', 'hooks/pre-commit'], { env })).trim().split('\n');
  } catch (error) {
    return { state: 'git-failed', reason: error instanceof Error ? error.message : String(error) };
  }
  const absolute = resolve(project, hookPath);
  const shown = relative(project, absolute);
  // On Windows a hook on another drive has no relative path.
  const path = isAbsolute(shown) ? absolute : shown;
  if (contains(resolve(project, commonDir), absolute)) return { state: 'found', path, absolute };
  if (!contains(project, absolute)) return { state: 'outside', path: absolute, absolute };
  if (await gitSucceeds(project, ['check-ignore', '-q', '--', path], { env })) return { state: 'found', path, absolute };
  return { state: 'in-project', path, absolute };
}

function contains(folder: string, file: string): boolean {
  const rel = relative(folder, file);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** On Windows X_OK only checks the file exists, so a hook there is never wrongly not executable. */
async function isExecutable(file: string): Promise<boolean> {
  try {
    await fs.access(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** What `installIngestHook` did, with the hook's path for the message when there is one. */
export type IngestHookInstall =
  | { result: 'skipped-no-git' }
  | { result: 'skipped-git-failed'; reason: string }
  | {
      result:
        | 'installed'
        | 'skipped-outside'
        | 'skipped-in-project'
        | 'skipped-existing'
        | 'skipped-unreadable'
        | 'skipped-unwritable'
        | 'skipped-not-executable';
      path: string;
    };

/**
 * Install the pre-commit hook into a scaffolded project.
 *
 * Never throws: an unwritable hooks directory, a missing `.git`, or a pre-existing hook must not
 * fail `init`. Returns what happened, and the hook's path when there is one, so the caller can report it honestly.
 */
export async function installIngestHook(projectPath: string): Promise<IngestHookInstall> {
  const hook = await ingestHookState(projectPath);
  if (hook.state === 'no-git') return { result: 'skipped-no-git' };
  if (hook.state === 'git-failed') return { result: 'skipped-git-failed', reason: hook.reason };
  const { path, absolute } = hook;
  if (hook.state === 'outside') return { result: 'skipped-outside', path };
  if (hook.state === 'in-project') return { result: 'skipped-in-project', path };
  // Something we cannot read stands there: not ours to replace, and init must not fail.
  if (hook.state === 'unreadable') return { result: 'skipped-unreadable', path };
  // Never clobber a hook we did not write — a designer's own hook wins.
  if (hook.state === 'foreign') return { result: 'skipped-existing', path };

  try {
    await fs.mkdir(dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, INGEST_PRE_COMMIT_HOOK, { mode: 0o755 });
    // writeFile's mode is ignored when the file already exists, so set it explicitly.
    await fs.chmod(absolute, 0o755);
  } catch {
    return { result: 'skipped-unwritable', path };
  }
  // A filesystem that keeps no mode bits takes the chmod and changes nothing (#1301).
  return { result: (await isExecutable(absolute)) ? 'installed' : 'skipped-not-executable', path };
}
