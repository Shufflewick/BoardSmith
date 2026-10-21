import { constants as fsConstants, promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { projectGitOutput } from './git-output.js';
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
 * hook for messages, relative to the project where it can be; `absolute` is the file itself, where
 * any symlink on the way lands.
 */
export type IngestHook =
  | { state: 'no-git' }
  | { state: 'git-failed'; reason: string }
  | HookAt<'outside' | 'in-project' | 'tracked' | 'missing' | 'current' | 'stale' | 'not-executable' | 'foreign' | 'unreadable'>;

/**
 * Why the ingest hook was not installed: a hook that is not ours to write, or what went wrong
 * writing it. `not-executable` here means it was written and git still skips it.
 */
export type IngestHookTrouble =
  | Exclude<IngestHook, { state: 'missing' | 'current' | 'stale' }>
  | HookAt<'unwritable' | 'not-owner'>;

/** One member per state, so a check of `state` narrows to it. */
type HookAt<State> = State extends string ? { state: State; path: string; absolute: string } : never;

/** What git said, without the command that was run, for a message that adds its own full stop. */
function gitReason(error: unknown): string {
  const said = (error as { stderr?: string }).stderr || (error instanceof Error ? error.message : String(error));
  return said.replace(/\.$/, '');
}

/** Whether git ignores `path`. A failure of git is not an answer, so it throws (#1301). */
async function ignored(project: string, path: string): Promise<boolean> {
  try {
    await projectGitOutput(project, ['check-ignore', '-q', '--', path]);
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

/** Whether git tracks `path`, which `check-ignore` does not see: an ignore rule never untracks a file (#1321). */
async function tracked(project: string, path: string): Promise<boolean> {
  return (await projectGitOutput(project, ['ls-files', '--', path])) !== '';
}

/**
 * The state of the `pre-commit` hook git runs for this project. Git names the path, so
 * `core.hooksPath` and a linked worktree's shared hooks are followed (#1186).
 * A folder with no `.git` of its own is `no-git`: a hook found above it would run from another top folder.
 * A `.git` git cannot read is `git-failed`, with git's own words.
 * The hook is judged where it lands once symlinks are followed, since a write goes there (#1321).
 * A hook path outside both the project and its git folder is `outside`: a global `core.hooksPath`
 * is shared by every repository on the machine, so it is not ours to write. One inside the project
 * that git tracks is `tracked`, and one git does not ignore is `in-project`: a hook written there
 * would be committed (#1301).
 * A hook carrying the marker is ours; any other is the designer's. Ours without the execute bit is
 * `not-executable`, whatever its version: git skips it, printing only a hint (#1187).
 */
export async function ingestHookState(projectPath: string): Promise<IngestHook> {
  const place = await hookPlace(projectPath);
  if (place.state !== 'found') return place;
  const { path, absolute } = place;
  let existing: string | undefined;
  let executable: boolean;
  try {
    existing = await readIfExists(absolute, (p) => fs.readFile(p, 'utf-8'));
    if (existing === undefined) return { state: 'missing', path, absolute };
    executable = await isExecutable(absolute);
  } catch {
    return { state: 'unreadable', path, absolute };
  }
  if (!existing.includes('BoardSmith ingest synthesis')) return { state: 'foreign', path, absolute };
  if (!executable) return { state: 'not-executable', path, absolute };
  return { state: existing === INGEST_PRE_COMMIT_HOOK ? 'current' : 'stale', path, absolute };
}

/** Where git runs the project's pre-commit hook from, or the state that says it is not ours to look at. */
async function hookPlace(
  projectPath: string,
): Promise<
  { state: 'found'; path: string; absolute: string } | Extract<IngestHook, { state: 'no-git' | 'git-failed' | 'outside' | 'in-project' | 'tracked' | 'unreadable' }>
> {
  try {
    await fs.access(join(projectPath, '.git'));
  } catch {
    return { state: 'no-git' };
  }
  // Git names real paths, so the project's must be real too, or every relative path runs through `..` (#1301).
  const project = await fs.realpath(projectPath);
  let commonDir: string;
  let hookPath: string;
  try {
    [commonDir, hookPath] = (await projectGitOutput(project, ['rev-parse', '--git-common-dir', '--git-path', 'hooks/pre-commit'])).trim().split('\n');
  } catch (error) {
    return { state: 'git-failed', reason: gitReason(error) };
  }
  let absolute: string;
  let gitFolder: string;
  try {
    absolute = await landing(resolve(project, hookPath));
    gitFolder = await landing(resolve(project, commonDir));
  } catch {
    absolute = resolve(project, hookPath);
    return { state: 'unreadable', path: shown(project, absolute), absolute };
  }
  const path = shown(project, absolute);
  if (contains(gitFolder, absolute)) return { state: 'found', path, absolute };
  if (!contains(project, absolute)) return { state: 'outside', path: absolute, absolute };
  try {
    if (await tracked(project, path)) return { state: 'tracked', path, absolute };
    return { state: (await ignored(project, path)) ? 'found' : 'in-project', path, absolute };
  } catch (error) {
    return { state: 'git-failed', reason: gitReason(error) };
  }
}

/** `absolute` relative to the project, or whole where it has no relative path, as on another drive on Windows. */
function shown(project: string, absolute: string): string {
  const rel = relative(project, absolute);
  return isAbsolute(rel) ? absolute : rel;
}

/** Where a write to `path` lands: every symlink followed, including a last one whose target does not exist yet. */
async function landing(path: string): Promise<string> {
  try {
    return await fs.realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const target = await fs.readlink(path).catch((error: NodeJS.ErrnoException) => {
    // Nothing there, or not a symlink: the path itself is where a write lands, under its real folder.
    if (error.code === 'ENOENT' || error.code === 'EINVAL') return undefined;
    throw error;
  });
  if (target !== undefined) return landing(resolve(dirname(path), target));
  return join(await landing(dirname(path)), basename(path));
}

function contains(folder: string, file: string): boolean {
  const rel = relative(folder, file);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Whether git may run `file`. Only EACCES means it may not; any other failure is not an answer, so
 * it throws. On Windows X_OK only checks the file exists, so a hook there is never wrongly not executable.
 */
async function isExecutable(file: string): Promise<boolean> {
  try {
    await fs.access(file, fsConstants.X_OK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EACCES') return false;
    throw error;
  }
}

/** What `installIngestHook` did: installed at `path`, or the hook it left as it found it, and why. */
export type IngestHookInstall = { result: 'installed'; path: string } | { result: 'skipped'; hook: IngestHookTrouble };

/**
 * Install the pre-commit hook into a scaffolded project.
 *
 * Never throws: an unwritable hooks directory, a missing `.git`, or a pre-existing hook must not
 * fail `init`. Returns what happened, so the caller can report it honestly with `ingestHookAdvice`.
 */
export async function installIngestHook(projectPath: string): Promise<IngestHookInstall> {
  const hook = await ingestHookState(projectPath);
  // Only a missing hook or our own is ours to write: a designer's own hook, or one we cannot read, wins.
  if (hook.state !== 'missing' && hook.state !== 'stale' && hook.state !== 'current' && hook.state !== 'not-executable') {
    return { result: 'skipped', hook };
  }
  return writeHook(hook.path, hook.absolute);
}

/** Write the current hook at `absolute`, executable, and say whether git will run it. */
async function writeHook(path: string, absolute: string): Promise<IngestHookInstall> {
  const skipped = (state: 'unwritable' | 'not-owner' | 'not-executable'): IngestHookInstall => ({ result: 'skipped', hook: { state, path, absolute } });
  try {
    await fs.mkdir(dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, INGEST_PRE_COMMIT_HOOK, { mode: 0o755 });
  } catch {
    return skipped('unwritable');
  }
  try {
    // writeFile's mode is ignored when the file already exists, and only its owner may change it.
    if (!(await isExecutable(absolute))) await fs.chmod(absolute, 0o755);
    // A filesystem that keeps no mode bits takes the chmod and changes nothing (#1301).
    return (await isExecutable(absolute)) ? { result: 'installed', path } : skipped('not-executable');
  } catch (error) {
    return skipped((error as NodeJS.ErrnoException).code === 'EPERM' ? 'not-owner' : 'unwritable');
  }
}

const BY_HAND = 'or run boardsmith ingest-gaps yourself after transcription.';

/** What each hook trouble says, so init and doctor use the same words for the same hook (#1321). */
const ADVICE: { [S in IngestHookTrouble['state']]: (hook: Extract<IngestHookTrouble, { state: S }>) => string } = {
  'no-git': () =>
    `This folder has no git repository, so the ingest pre-commit hook is not installed. Run git init, then boardsmith doctor --fix, ${BY_HAND}`,
  'git-failed': (hook) =>
    `Could not check the ingest pre-commit hook: ${hook.reason}. Fix what git reports, then run boardsmith doctor --fix, ${BY_HAND}`,
  'in-project': (hook) =>
    `Left ${hook.path} alone: git runs hooks from a folder inside this project that git does not ignore (core.hooksPath), ` +
    `so a hook written there would be committed and shared with everyone, and the ingest hook is not installed. ` +
    `If that folder is meant to stay out of git, add it to .gitignore and run boardsmith doctor --fix, ${BY_HAND}`,
  tracked: (hook) =>
    `Left ${hook.path} alone: git runs it as the pre-commit hook and it is committed to this project, ` +
    `so a change to it would be shared with everyone, and the ingest hook is not installed. ` +
    `If its folder is meant to stay out of git, add it to .gitignore, run git rm --cached ${hook.path}, then boardsmith doctor --fix, ${BY_HAND}`,
  outside: (hook) =>
    `Left ${hook.path} alone: git runs hooks from a folder outside this project, which other repositories may share, ` +
    `so the ingest hook is not installed. Run boardsmith ingest-gaps yourself after transcription.`,
  foreign: (hook) =>
    `Left ${hook.path} alone: BoardSmith did not write it, so the ingest hook is not installed. To use BoardSmith's, ` +
    `move your commands elsewhere, delete ${hook.path} and run boardsmith doctor --fix, ${BY_HAND}`,
  unreadable: (hook) =>
    `Left ${hook.path} alone: could not read it, so BoardSmith cannot tell whether it wrote it, and the ingest hook is not installed. ` +
    `Check that you can read it, then run boardsmith doctor --fix, ${BY_HAND}`,
  unwritable: (hook) =>
    `Could not write ${hook.path}, so the ingest hook is not installed. Check that you can write to its folder, then run boardsmith doctor --fix, ${BY_HAND}`,
  'not-owner': (hook) =>
    `Could not make ${hook.path} executable: it belongs to another user, so git skips it. ` +
    `Ask them to make it executable or delete it, then run boardsmith doctor --fix, ${BY_HAND}`,
  'not-executable': (hook) =>
    `Wrote ${hook.path}, but git skips it: its execute bit did not take, as on a filesystem that keeps no permissions or is mounted noexec. ` +
    `Move the project to a filesystem that lets files run, ${BY_HAND}`,
};

/** Why the ingest hook is not installed and what to do about it, in the same words from init and doctor (#1321). */
export function ingestHookAdvice(hook: IngestHookTrouble): string {
  // TypeScript cannot pair a union member with its own entry, so the lookup is widened.
  return (ADVICE[hook.state] as (hook: IngestHookTrouble) => string)(hook);
}
