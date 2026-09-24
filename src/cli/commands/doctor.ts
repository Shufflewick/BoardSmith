import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import chalk from 'chalk';
import {
  CHUNKS_DIR,
  DESIGN_DIR,
  DESIGN_LEDGERS,
  RULEBOOK_DIR,
  SCRATCH_DIR,
} from '../lib/project-paths.js';
import {
  VITEST_CONFIG_FILE,
  findViteConfig,
  findVitestConfig,
  generateVitestConfig,
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
 * TEST RUNS COVER THIS CHECKOUT ONLY (#298). Chunk worktrees live under `.boardsmith/worktrees/`,
 * inside the project, and the project's vitest config is the one place that leaves them out of a
 * test run. A project with no vitest config gets the one `init` writes; a `vitest.config.*` the
 * designer wrote is reported with the line to add, never edited.
 *
 * NOTHING IS EVER DELETED. Stray scratch is MOVED into `.boardsmith/scratch/`, not removed: a file
 * whose only evidence of value is that someone wrote it is not this command's to throw away. Moves
 * use `git mv` for tracked paths so history survives, and a plain rename otherwise. A move whose
 * destination already exists is reported as a conflict and skipped — `doctor` never clobbers.
 */

/** What kind of thing `doctor` found out of place. */
export type DoctorFindingKind =
  /** A design artifact still sitting in the project root instead of `design/`. */
  | 'design-artifact-in-root'
  /** A throwaway script left in the project root instead of `.boardsmith/scratch/`. */
  | 'scratch-in-root'
  /** `.gitignore` does not ignore `.boardsmith/`, so scratch written there would be committed. */
  | 'scratch-dir-not-ignored'
  /** Test runs would also collect the chunk worktrees under `.boardsmith/worktrees/`; `--fix` writes `vitest.config.ts`. */
  | 'test-run-collects-worktrees'
  /** The project's own `vitest.config.*` does not leave `.boardsmith/` out; only a person should edit it. */
  | 'test-config-needs-edit'
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

/** True when `.gitignore` already keeps `.boardsmith/` out of commits. */
async function gitignoreCovers(projectDir: string): Promise<boolean> {
  try {
    const text = await fs.readFile(join(projectDir, '.gitignore'), 'utf-8');
    return text.split('\n').some((line) => line.trim() === GITIGNORE_ENTRY);
  } catch {
    return false;
  }
}

/** Append the ignore rule, preserving whatever the designer already put in `.gitignore`. */
async function appendGitignoreEntry(projectDir: string): Promise<void> {
  const path = join(projectDir, '.gitignore');
  let existing = '';
  try {
    existing = await fs.readFile(path, 'utf-8');
  } catch {
    // No .gitignore yet — write one.
  }
  const prefix = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`;
  await fs.writeFile(
    path,
    `${prefix}\n# Dev-host build output and agent scratch — never committed.\n${GITIGNORE_ENTRY}\n`,
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
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
  await runGit(projectDir, ['rm', '--cached', '--quiet', '--', path]);
}

function runGit(projectDir: string, args: string[]): Promise<{ ok: boolean }> {
  return new Promise((resolvePromise) => {
    execFile('git', args, { cwd: projectDir }, (err) => resolvePromise({ ok: !err }));
  });
}

async function gitTracks(projectDir: string, path: string): Promise<boolean> {
  const { ok } = await runGit(projectDir, ['ls-files', '--error-unmatch', '--', path]);
  return ok;
}

async function gitMv(projectDir: string, from: string, to: string): Promise<boolean> {
  const { ok } = await runGit(projectDir, ['mv', '--', from, to]);
  return ok;
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
    rootEntries = [];
  }
  const findings: DoctorFinding[] = [];
  for (const e of rootEntries.filter((e) => e.isFile() && SCRATCH_FILE_RE.test(e.name))) {
    const to = join(SCRATCH_DIR, e.name);
    if (await exists(join(projectDir, to))) {
      findings.push({
        kind: 'move-conflict',
        from: e.name,
        to,
        fixed: false,
        detail: `${to} already exists — rename or delete it, then re-run.`,
      });
      continue;
    }
    findings.push({ kind: 'scratch-in-root', from: e.name, to, fixed: false });
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
  const config = await findVitestConfig(projectDir);
  // A vitest.config.* the designer wrote is theirs to edit; doctor only writes one where none exists.
  if (config !== undefined && !config.startsWith('vite.config.')) {
    return [{ kind: 'test-config-needs-edit', from: config, to: config, fixed: false, detail: problem }];
  }
  return [
    { kind: 'test-run-collects-worktrees', from: VITEST_CONFIG_FILE, to: VITEST_CONFIG_FILE, fixed: false, detail: problem },
  ];
}

/** Resolve one finding `--fix` is allowed to resolve. */
async function fix(projectDir: string, f: DoctorFinding): Promise<void> {
  if (f.kind === 'test-run-collects-worktrees') {
    await fs.writeFile(join(projectDir, VITEST_CONFIG_FILE), generateVitestConfig(await findViteConfig(projectDir)));
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

  const findings: DoctorFinding[] = [
    ...(await strandedDesignFindings(projectDir)),
    ...(await strandedScratchFindings(projectDir)),
    ...(await gitignoreFindings(projectDir)),
    ...(await testScopeFindings(projectDir)),
  ];

  if (options.fix) {
    // `design/` and the scratch dir are created lazily — a healthy project that needs no moves
    // should not grow empty directories just because doctor ran.
    for (const f of findings) {
      if (NEEDS_A_PERSON.has(f.kind)) continue;
      await fix(projectDir, f);
      f.fixed = true;
    }
  }

  const result = summarize(projectDir, findings);
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
function summarize(projectDir: string, findings: DoctorFinding[]): DoctorResult {
  const moved = findings.filter((f) => f.fixed).length;
  const conflicts = findings.filter((f) => NEEDS_A_PERSON.has(f.kind)).length;
  const pending = findings.length - moved - conflicts;
  return { projectDir, findings, counts: { moved, pending, conflicts }, healthy: findings.length === 0 };
}

/** One finding as a report line; `rel` makes a project path relative to where doctor was run. */
function reportLine(f: DoctorFinding, rel: (p: string) => string): string {
  switch (f.kind) {
    case 'move-conflict':
      return `${chalk.red('conflict')} ${rel(f.from)}\n          ${f.detail}`;
    case 'test-config-needs-edit':
      return `${chalk.red('edit    ')} ${rel(f.from)}\n          ${f.detail}`;
    case 'test-run-collects-worktrees':
      return `${f.fixed ? chalk.green('wrote   ') : chalk.yellow('missing ')} ${rel(f.from)} ${chalk.dim('->')} leaves .boardsmith/ out of test runs`;
    case 'scratch-dir-not-ignored':
      return `${f.fixed ? chalk.green('ignored ') : chalk.yellow('untracked')} ${rel(f.from)} ${chalk.dim('->')} adds ${GITIGNORE_ENTRY}`;
    default:
      return `${f.fixed ? chalk.green('moved   ') : chalk.yellow('misplaced')} ${rel(f.from)} ${chalk.dim('->')} ${rel(f.to)}`;
  }
}

function printReport(result: DoctorResult, fixed: boolean): void {
  const rel = (p: string) => relative(process.cwd(), join(result.projectDir, p)) || p;

  if (result.healthy) {
    console.log(chalk.green(`✓ layout is current — ${DESIGN_DIR}/ holds every design artifact`));
    return;
  }

  for (const f of result.findings) console.log(reportLine(f, rel));

  const { moved, pending, conflicts } = result.counts;
  console.log('');
  if (fixed) {
    console.log(`${moved} fixed, ${conflicts} conflict(s) left for you.`);
  } else {
    console.log(
      `${pending} to fix, ${conflicts} conflict(s).\n` +
        `Run ${chalk.cyan('boardsmith doctor --fix')} to put them right.`,
    );
  }
}
