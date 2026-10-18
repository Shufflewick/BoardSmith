import { promises as fs } from 'node:fs';
import { gitSucceeds } from '../lib/git-output.js';
import { readIfExists } from '../lib/read-if-exists.js';
import { ingestHookState, installIngestHook } from '../lib/ingest-hook.js';
import { join, relative, resolve } from 'node:path';
import { styleText } from 'node:util';
import {
  CHUNKS_DIR,
  DESIGN_DIR,
  DESIGN_LEDGERS,
  RULEBOOK_DIR,
  SCRATCH_DIR,
} from '../lib/project-paths.js';
import {
  GAME_VITE_CONFIG,
  GAME_VITE_CONFIG_FILE,
  buildsWithGameConfig,
  existingConfigs,
  settingNotShipped,
  testRunScopeProblem,
} from '../lib/test-run-scope.js';

/**
 * `boardsmith doctor` — the one place that knows what a bs-built project's layout is supposed to
 * look like, and the one thing that puts a project back into it.
 *
 * WHY THIS EXISTS (issue #6)
 *
 * The bs- skills used to author every design artifact loose in the project root — `SKETCH.md`,
 * `RULINGS.md`, `chunks/`, `rulebook/` — mixed in with `src/`, `tests/` and `package.json`. Worse,
 * sessions dropped throwaway repro scripts (`_dbg.mjs`, `_cap_tmp.mjs`) beside them, and those got
 * committed. Everything the skills author now lives under `design/`, and every throwaway script
 * belongs in the gitignored `.boardsmith/scratch/`.
 *
 * A layout change with games already built against the old one needs a migration, and a migration
 * a model performs by hand is a migration that gets performed differently every time. This is a
 * CLI command instead: deterministic, unit-testable, and idempotent, so every bs- skill can open
 * by running it without thinking about whether it already ran.
 *
 * REPORT-BY-DEFAULT, MOVE-ON-`--fix`
 *
 * Bare `doctor` reports and exits non-zero when anything is out of place — a non-zero exit is the
 * signal that reliably gets acted on. `--fix` performs the moves.
 *
 * TEST RUNS COVER THIS CHECKOUT ONLY (#298, #528). Chunk worktrees live under `.boardsmith/worktrees/`,
 * inside the project, and the config a game builds with `defineGameViteConfig` leaves them out of a
 * test run. A project whose config is not built with it gets the one `init` writes, in place of its
 * vite and vitest configs, when they set nothing `defineGameViteConfig()` does not; a config with
 * settings of its own is reported with what to carry over, never edited.
 *
 * NOTHING ELSE IS EVER DELETED. Stray scratch is MOVED into `.boardsmith/scratch/`, not removed: a file
 * whose only evidence of value is that someone wrote it is not this command's to throw away. Moves
 * use `git mv` for tracked paths so history survives, and a plain rename otherwise. A move whose
 * destination already exists is reported as a conflict and skipped — `doctor` never clobbers.
 *
 * THE INGEST PRE-COMMIT HOOK (#1009). A missing hook (a fresh clone) or a stale BoardSmith one is a
 * finding `--fix` installs. A hook BoardSmith did not write, or one it cannot read, is only a note:
 * every bs- skill gates on doctor's exit code, and a designer's own hook must not block them.
 */

/** What kind of thing `doctor` found out of place. */
export type DoctorFindingKind =
  /** A design artifact still sitting in the project root instead of `design/`. */
  | 'design-artifact-in-root'
  /** A throwaway script left in the project root instead of `.boardsmith/scratch/`. */
  | 'scratch-in-root'
  /** `.gitignore` does not ignore `.boardsmith/`, so scratch written there would be committed. */
  | 'scratch-dir-not-ignored'
  /** There is no vite or vitest config; `--fix` writes the one-line `vite.config.ts`. */
  | 'test-config-missing'
  /**
   * The config vitest reads is not built with `defineGameViteConfig`, and nothing would be lost
   * without it; `--fix` deletes it, and writes the one-line `vite.config.ts` when no config is built with it.
   */
  | 'test-run-collects-worktrees'
  /** The config is not built with `defineGameViteConfig` and has settings of its own; only a person should carry them over. */
  | 'test-config-needs-edit'
  /** `.git/hooks/pre-commit` is missing or an older BoardSmith ingest hook; `--fix` writes the current one. */
  | 'ingest-hook-not-current'
  /** Both the root and the `design/` copy exist — a human has to decide which one is real. */
  | 'move-conflict';

export interface DoctorFinding {
  kind: DoctorFindingKind;
  /** Project-relative path of the offending file or directory. */
  from: string;
  /** Project-relative path it belongs at. */
  to: string;
  /** True once `--fix` has actually performed the move. */
  fixed: boolean;
  /** Set for the findings `--fix` does not resolve itself, and for the ignore and test-run rules — what is wrong. */
  detail?: string;
}

export interface DoctorResult {
  projectDir: string;
  findings: DoctorFinding[];
  counts: { moved: number; pending: number; conflicts: number };
  /** What doctor left alone and why, without failing the run. */
  notes: string[];
  /** True when the project is already in the current layout and nothing needs doing. */
  healthy: boolean;
}

/**
 * Root-level filenames that are a session's throwaway script rather than part of the project.
 *
 * Deliberately narrow: a LEADING UNDERSCORE on a root-level script file. Every junk file issue #6
 * reported matches it (`_dbg.mjs`, `_dbg2.mjs`, `_cap_tmp.mjs`, `_drive_tmp.mjs`,
 * `_drive2_tmp.mjs`) and nothing a scaffolded project legitimately contains does. A broader
 * heuristic ("looks temporary") would eventually move someone's real file, and this command's
 * whole value is that it can be run blind.
 */
const SCRATCH_FILE_RE = /^_.*\.(mjs|cjs|js|ts)$/;

/** Findings `--fix` leaves alone because only a person can resolve them; counted as conflicts. */
const NEEDS_A_PERSON: ReadonlySet<DoctorFindingKind> = new Set(['move-conflict', 'test-config-needs-edit']);

/** The design artifacts `design/` owns, in the order `doctor` reports them. */
const DESIGN_ENTRIES: readonly string[] = [...DESIGN_LEDGERS, RULEBOOK_DIR, CHUNKS_DIR];

/** The `.gitignore` lines git applies exactly as it does `.boardsmith/` at the project root. */
const GITIGNORE_EQUIVALENTS: ReadonlySet<string> = new Set(['.boardsmith/', '.boardsmith', '/.boardsmith/', '/.boardsmith']);

/**
 * True when `.gitignore` already keeps `.boardsmith/` out of commits. Read as text, not through
 * `git check-ignore`, because doctor also runs on projects that are not git repositories yet.
 */
async function gitignoreCovers(projectDir: string): Promise<boolean> {
  const text = await readIfExists(join(projectDir, '.gitignore'), (p) => fs.readFile(p, 'utf-8'));
  return text !== undefined && text.split('\n').some((line) => GITIGNORE_EQUIVALENTS.has(line.trim()));
}

/** Append the ignore rule, preserving whatever the designer already put in `.gitignore`. */
export async function appendGitignoreEntry(projectDir: string): Promise<void> {
  const path = join(projectDir, '.gitignore');
  const existing = (await readIfExists(path, (p) => fs.readFile(p, 'utf-8'))) ?? '';
  const prefix = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`;
  await fs.writeFile(
    path,
    `${prefix}\n# Dev-host build output and agent scratch — never committed.\n${GITIGNORE_ENTRY}\n`,
  );
}

/**
 * Whether anything stands at `path`, a link that cannot be followed included, so a move never lands on it.
 * At a source path that is deliberate too: a dangling link there is stranded and moved like any file.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path);
    return true;
  } catch {
    // A health check: a path it cannot look at all (an unsearchable folder above it) is not a finding.
    return false;
  }
}

/**
 * The `.gitignore` line that keeps `.boardsmith/` — dev-host build output and the scratch
 * directory — out of every commit. `boardsmith init` writes it; a project scaffolded before it
 * existed has to be given it, or moving scratch into `.boardsmith/scratch/` merely relocates a
 * tracked file instead of untracking it.
 */
const GITIGNORE_ENTRY = '.boardsmith/';

/**
 * `git mv` when the path is tracked, plain rename otherwise.
 *
 * Tracked design docs carry the project's whole rules-interpretation history; a rename git sees as
 * delete+add makes `git log --follow` and every `Verified Commit Hash` archaeology harder for no
 * reason. Falls back to a rename whenever git cannot do it (not a repo, path untracked, git
 * missing) — a migration must never be blocked by version control.
 */
async function move(projectDir: string, from: string, to: string): Promise<void> {
  const absFrom = join(projectDir, from);
  const absTo = join(projectDir, to);
  await fs.mkdir(resolve(absTo, '..'), { recursive: true });

  const tracked = await gitTracks(projectDir, from);
  if (tracked && (await gitMv(projectDir, from, to))) return;

  await fs.rename(absFrom, absTo);
}

/**
 * Stop tracking a file that has moved into a gitignored directory, WITHOUT deleting it.
 *
 * `.gitignore` has no effect on an already-tracked path, so a `git mv` of `_dbg.mjs` into
 * `.boardsmith/scratch/` would leave the junk committed — just at a tidier path. `git rm --cached`
 * is the one operation that untracks a file and leaves the bytes on disk, which is exactly issue
 * #6's "clean up after itself" without ever destroying someone's work.
 */
async function untrack(projectDir: string, path: string): Promise<void> {
  if (!(await gitTracks(projectDir, path))) return;
  await gitSucceeds(projectDir, ['rm', '--cached', '--quiet', '--', path]);
}

function gitTracks(projectDir: string, path: string): Promise<boolean> {
  return gitSucceeds(projectDir, ['ls-files', '--error-unmatch', '--', path]);
}

function gitMv(projectDir: string, from: string, to: string): Promise<boolean> {
  return gitSucceeds(projectDir, ['mv', '--', from, to]);
}

/** Design artifacts stranded in the project root. */
async function strandedDesignFindings(projectDir: string): Promise<DoctorFinding[]> {
  const findings: DoctorFinding[] = [];
  for (const entry of DESIGN_ENTRIES) {
    const from = entry;
    const to = join(DESIGN_DIR, entry);
    if (!(await exists(join(projectDir, from)))) continue;

    if (await exists(join(projectDir, to))) {
      findings.push({
        kind: 'move-conflict',
        from,
        to,
        fixed: false,
        detail:
          `both ${from} and ${to} exist — doctor will not choose between them. ` +
          `Merge them by hand, delete the stale one, then re-run.`,
      });
      continue;
    }
    findings.push({ kind: 'design-artifact-in-root', from, to, fixed: false });
  }
  return findings;
}

/** Throwaway scripts stranded in the project root. */
async function strandedScratchFindings(projectDir: string): Promise<DoctorFinding[]> {
  let rootEntries: Array<{ name: string; isFile(): boolean }> = [];
  try {
    rootEntries = await fs.readdir(projectDir, { withFileTypes: true });
  } catch {
    // A health check: a root it cannot list has no stranded scripts to report.
    rootEntries = [];
  }
  const findings: DoctorFinding[] = [];
  for (const entry of rootEntries.filter((e) => e.isFile() && SCRATCH_FILE_RE.test(e.name))) {
    const to = join(SCRATCH_DIR, entry.name);
    if (await exists(join(projectDir, to))) {
      findings.push({
        kind: 'move-conflict',
        from: entry.name,
        to,
        fixed: false,
        detail: `${to} already exists — rename or delete it, then re-run.`,
      });
      continue;
    }
    findings.push({ kind: 'scratch-in-root', from: entry.name, to, fixed: false });
  }
  return findings;
}

/**
 * `.gitignore` must actually ignore the scratch tree. Checked unconditionally, not only when
 * scratch exists: the point is that the NEXT script a session writes lands somewhere git will not
 * pick up.
 */
async function gitignoreFindings(projectDir: string): Promise<DoctorFinding[]> {
  if (await gitignoreCovers(projectDir)) return [];
  return [
    {
      kind: 'scratch-dir-not-ignored',
      from: '.gitignore',
      to: '.gitignore',
      fixed: false,
      detail: `.gitignore does not list ${GITIGNORE_ENTRY} — scratch written there would be committed.`,
    },
  ];
}

/** Test runs must cover this checkout only, not the chunk worktrees inside it (#298). */
async function testScopeFindings(projectDir: string): Promise<DoctorFinding[]> {
  const problem = await testRunScopeProblem(projectDir);
  if (problem === undefined) return [];
  const { built, outdated } = await sortConfigs(projectDir);
  const to = built ?? GAME_VITE_CONFIG_FILE;
  // With nothing outdated, nothing is built either: vitest would read the built one and see no problem.
  if (outdated.length === 0) return [{ kind: 'test-config-missing', from: to, to, fixed: false, detail: problem }];
  const own = await ownSettingFinding(projectDir, outdated, built, problem);
  if (own !== undefined) return [own];
  const detail = built === undefined
    ? problem
    : `vitest reads ${outdated[0]} in place of ${built}, which is already built with defineGameViteConfig. ` +
      `Delete ${outdated.join(' and ')} (--fix does), then run this again.`;
  return [{ kind: 'test-run-collects-worktrees', from: outdated[0], to, fixed: false, detail }];
}

/** A hand edit for the first outdated config that sets more than `defineGameViteConfig()`, which --fix would lose. */
async function ownSettingFinding(
  projectDir: string,
  outdated: string[],
  built: string | undefined,
  problem: string,
): Promise<DoctorFinding | undefined> {
  for (const config of outdated) {
    const setting = settingNotShipped(await fs.readFile(join(projectDir, config), 'utf-8'));
    if (setting === undefined) continue;
    const found = `${config} sets more than defineGameViteConfig() does (${setting}), so --fix leaves it to you`;
    const detail = built === undefined
      ? `${found}. ${problem}`
      : `${found}: vitest reads it in place of ${built}, which is already built with defineGameViteConfig. ` +
        `If the game needs it, pass it to defineGameViteConfig in ${built}, then delete ${config}.`;
    return { kind: 'test-config-needs-edit', from: config, to: built ?? GAME_VITE_CONFIG_FILE, fixed: false, detail };
  }
  return undefined;
}

/** The project's config built with `defineGameViteConfig`, if one is, and every other vite or vitest config. */
async function sortConfigs(projectDir: string): Promise<{ built: string | undefined; outdated: string[] }> {
  let built: string | undefined;
  const outdated: string[] = [];
  for (const config of await existingConfigs(projectDir)) {
    if (built === undefined && buildsWithGameConfig(await fs.readFile(join(projectDir, config), 'utf-8'))) built = config;
    else outdated.push(config);
  }
  return { built, outdated };
}

const HOOK_PATH = '.git/hooks/pre-commit';

/** The ingest hook as a finding when `--fix` can bring it up to date, or as a note when it is not ours to touch. */
async function ingestHookCheck(projectDir: string): Promise<{ findings: DoctorFinding[]; notes: string[] }> {
  const state = await ingestHookState(projectDir);
  const byHand = 'or run boardsmith ingest-gaps yourself after transcription.';
  if (state === 'foreign') {
    return { findings: [], notes: [
      `Left ${HOOK_PATH} alone: BoardSmith did not write it, so the ingest hook is not installed. To use BoardSmith's, ` +
        `move your commands elsewhere, delete ${HOOK_PATH} and run boardsmith doctor --fix; ${byHand}`,
    ] };
  }
  if (state === 'unreadable') {
    return { findings: [], notes: [
      `Left ${HOOK_PATH} alone: could not read ${HOOK_PATH}, so doctor cannot tell whether BoardSmith wrote it. ` +
        `Check that you can read it, then run boardsmith doctor again; ${byHand}`,
    ] };
  }
  if (state !== 'missing' && state !== 'stale') return { findings: [], notes: [] };
  const detail = state === 'missing'
    ? 'no ingest pre-commit hook is installed, so commits do not run the ingest synthesis.'
    : 'the ingest pre-commit hook is an older version than this BoardSmith writes.';
  return { findings: [{ kind: 'ingest-hook-not-current', from: HOOK_PATH, to: HOOK_PATH, fixed: false, detail }], notes: [] };
}

/**
 * Resolve every finding `--fix` is allowed to resolve. `design/` and the scratch dir are created
 * lazily, so a healthy project that needs no moves does not grow empty directories.
 */
async function fixAll(projectDir: string, findings: DoctorFinding[]): Promise<void> {
  for (const f of findings) {
    if (NEEDS_A_PERSON.has(f.kind)) continue;
    await fix(projectDir, f);
    f.fixed = true;
  }
}

/** Resolve one finding `--fix` is allowed to resolve. */
async function fix(projectDir: string, f: DoctorFinding): Promise<void> {
  if (f.kind === 'ingest-hook-not-current') {
    if ((await installIngestHook(projectDir)) === 'installed') return;
    throw new Error(`Could not write ${HOOK_PATH}. Check that you can write to .git/hooks, then run boardsmith doctor --fix again.`);
  }
  if (f.kind === 'test-config-missing' || f.kind === 'test-run-collects-worktrees') {
    const { built, outdated } = await sortConfigs(projectDir);
    for (const config of outdated) await fs.rm(join(projectDir, config));
    if (built === undefined) await fs.writeFile(join(projectDir, GAME_VITE_CONFIG_FILE), GAME_VITE_CONFIG);
    return;
  }
  if (f.kind === 'scratch-dir-not-ignored') {
    await appendGitignoreEntry(projectDir);
    return;
  }
  await move(projectDir, f.from, f.to);
  // Scratch moved into the gitignored tree must also stop being tracked, or it stays
  // committed at its new path. Ordered after the move so the untrack names the final path.
  if (f.kind === 'scratch-in-root') await untrack(projectDir, f.to);
}

/**
 * Inspect a project's layout, and with `fix` move everything into place.
 *
 * Idempotent by construction: it reports what is out of place RIGHT NOW, so a second run on a
 * healthy project finds nothing. That is what lets every bs- skill open with it unconditionally.
 */
export async function doctorCommand(
  options: { project?: string; fix?: boolean; json?: boolean; quiet?: boolean } = {},
): Promise<DoctorResult> {
  const projectDir = resolve(options.project ?? process.cwd());

  if (!(await exists(join(projectDir, 'boardsmith.json')))) {
    throw new Error(
      `No boardsmith.json in ${projectDir}.\n` +
        `boardsmith doctor checks a game project's layout — run it from inside a project\n` +
        `created by "boardsmith init", or pass --project <dir>.`,
    );
  }

  const hook = await ingestHookCheck(projectDir);
  const findings: DoctorFinding[] = [
    ...(await strandedDesignFindings(projectDir)),
    ...(await strandedScratchFindings(projectDir)),
    ...(await gitignoreFindings(projectDir)),
    ...(await testScopeFindings(projectDir)),
    ...hook.findings,
  ];

  if (options.fix) await fixAll(projectDir, findings);

  const result = summarize(projectDir, findings, hook.notes);
  const { pending, conflicts } = result.counts;

  // A project needing work exits non-zero so a skill or a CI step notices without parsing output.
  // `--fix` that resolved everything is a success; unresolved conflicts are not.
  if (pending > 0 || conflicts > 0) process.exitCode = 1;

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  if (!options.quiet) printReport(result, options.fix === true);
  return result;
}

/** The result `doctor` returns: its findings and how many were fixed, remain, or need a person. */
function summarize(projectDir: string, findings: DoctorFinding[], notes: string[]): DoctorResult {
  const moved = findings.filter((f) => f.fixed).length;
  const conflicts = findings.filter((f) => NEEDS_A_PERSON.has(f.kind)).length;
  const pending = findings.length - moved - conflicts;
  return { projectDir, findings, counts: { moved, pending, conflicts }, notes, healthy: findings.length === 0 };
}

/** A config finding as a report line: what is missing or outdated, and until fixed, what to do. */
function configLine(f: DoctorFinding, rel: (p: string) => string): string {
  const where = `${rel(f.from)} ${styleText('dim', '->')} ${rel(f.to)} built with defineGameViteConfig`;
  if (f.fixed) return `${styleText('green', 'fixed   ')} ${where}`;
  return `${styleText('yellow', f.kind === 'test-config-missing' ? 'missing ' : 'outdated')} ${where}\n          ${f.detail}`;
}

/** The ingest hook finding as a report line: installed, or what is wrong with it. */
function hookLine(f: DoctorFinding): string {
  if (f.fixed) return `${styleText('green', 'installed')} ${f.from} ${styleText('dim', '->')} the current ingest hook`;
  return `${styleText('yellow', 'hook    ')} ${f.from}\n          ${f.detail}`;
}

/** One finding as a report line; `rel` makes a project path relative to where doctor was run. */
function reportLine(f: DoctorFinding, rel: (p: string) => string): string {
  switch (f.kind) {
    case 'move-conflict':
      return `${styleText('red', 'conflict')} ${rel(f.from)}\n          ${f.detail}`;
    case 'test-config-needs-edit':
      return `${styleText('red', 'edit    ')} ${rel(f.from)}\n          ${f.detail}`;
    case 'test-config-missing':
    case 'test-run-collects-worktrees':
      return configLine(f, rel);
    case 'ingest-hook-not-current':
      return hookLine(f);
    case 'scratch-dir-not-ignored':
      return `${f.fixed ? styleText('green', 'ignored ') : styleText('yellow', 'untracked')} ${rel(f.from)} ${styleText('dim', '->')} adds ${GITIGNORE_ENTRY}`;
    default:
      return `${f.fixed ? styleText('green', 'moved   ') : styleText('yellow', 'misplaced')} ${rel(f.from)} ${styleText('dim', '->')} ${rel(f.to)}`;
  }
}

function printReport(result: DoctorResult, fixed: boolean): void {
  const rel = (p: string) => relative(process.cwd(), join(result.projectDir, p)) || p;

  for (const note of result.notes) console.log(`${styleText('dim', 'note    ')} ${note}`);
  if (result.healthy) {
    console.log(styleText('green', `✓ layout is current — ${DESIGN_DIR}/ holds every design artifact`));
    return;
  }

  for (const f of result.findings) console.log(reportLine(f, rel));

  const { moved, pending, conflicts } = result.counts;
  console.log('');
  if (fixed) {
    console.log(`${moved} fixed, ${conflicts} conflict(s) left for you.`);
  } else {
    console.log(closingAdvice(pending, conflicts));
  }
}

/**
 * What to do next after a report without `--fix`. `--fix` resolves only the fixable findings, so
 * it is offered only for those; conflicts are sent to the hand-edit instructions printed above.
 */
function closingAdvice(pending: number, conflicts: number): string {
  const fixCommand = styleText('cyan', 'boardsmith doctor --fix');
  const handEdit = '--fix cannot resolve them. Follow the instructions printed under each one above.';
  if (conflicts === 0) return `${pending} to fix.\nRun ${fixCommand} to put them right.`;
  if (pending === 0) return `${conflicts} conflict(s) need a hand edit; ${handEdit}`;
  return (
    `${pending} to fix, ${conflicts} conflict(s).\n` +
    `Run ${fixCommand} to put the ${pending} fixable finding(s) right. The conflict(s) need a hand edit; ${handEdit}`
  );
}
