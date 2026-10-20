/**
 * `boardsmith verify [--base <git-ref> | --chunk <slug>]` and `boardsmith verify --check [--chunk <slug>]` (#452).
 *
 * The mechanical checks a game needs before anyone may say "done" used to be five separate
 * commands, asked for in prose, and nothing checked that a report of "all green" was backed by a
 * run. Builder agents reported green after running two related test files; one broke 43 tests in
 * 27 files that way. So this command runs every check, in order, WITHOUT stopping at the first
 * failure, and records the outcome for the commit it ran on:
 *
 *   1. test       the full suite, exactly as `boardsmith test` with no pattern runs it
 *   2. typecheck  vue-tsc over the project's tsconfig.json, as `boardsmith typecheck` runs it
 *   3. build      `boardsmith build`, in this process
 *   4. validate   `boardsmith validate`, in this process, reporting the typecheck's own run rather
 *                 than compiling the project a second time (#532)
 *   5. smoke      `tests/browser/smoke.spec.ts` in Chromium against `boardsmith dev`, served from a
 *                 fresh copy of the project (`smoke.ts`): a seated player takes every offered action
 *                 and presses every board control, and any page error, console error, failed
 *                 request or failed action fails it
 *   6. mutation   every code line under `src/` changed since the base, broken one small change at a
 *                 time; for each, a test that loads its file must fail, and a change in a file no
 *                 test loads fails the check too (`runDiffMutationCheck`, #981). An outcome from
 *                 an earlier run of the same code and tests is reused (`lib/mutant-cache.ts`), so a
 *                 re-verify after a bookkeeping-only commit runs no mutant again. The cache is shared
 *                 by every worktree, so a merge reuses what a worktree ran when the merged tree is
 *                 the one it verified (main has not moved, or the branch merged main and verified).
 *
 * The base is the merge base of HEAD with `--base`, or with the main branch (`main`, else `master`).
 * On the main branch itself that merge base is HEAD, which measures no change, so without `--base`
 * the mutation check fails there and says to pass the commit the work started from.
 *
 * `--chunk <slug>` runs only the fast checks a chunk's gates need (#985): the test files the chunk
 * added or changed since its verify base, the commit before its first `chunk-<slug>/` commit
 * (`lib/chunk-commits.ts`), and typecheck. It records the chunk in the result. The full checks
 * above run once, before publish (#984), not per chunk.
 *
 * A tree with uncommitted changes is refused before any check runs: a result is tied to a commit.
 * The result goes to `.boardsmith/verify/<commit>.json` (`lib/verify-result.ts`), with whether the
 * tree stayed clean while the checks ran. The exit code is non-zero when any check failed, and also
 * when the tree changed during the run; such a run never replaces a clean passing result on file.
 * When what the tests run with (BoardSmith, the installed or linked packages) changed during the run,
 * nothing is recorded and no mutant outcome is kept: the run stops with an error naming what changed (#932).
 *
 * `--check` runs nothing. It exits 0 only when HEAD, on a clean tree, has a passing full result.
 * With `--chunk <slug>` it asks instead for that chunk's passing fast checks, the question
 * `chunk-signoff <slug>` and `review-gate <slug>` ask too (`verifiedProblem`).
 */
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import { join, relative, resolve as pathResolve } from 'node:path';
import { styleText } from 'node:util';
import { chunkBeforeSpec, chunkVerifyBase, commitName, preSpecCodeChanges } from '../lib/chunk-commits.js';
import { gitOutput as git, gitSucceeds } from '../lib/git-output.js';
import { type MutantCache, captureExecutionContext, executionContextChange, openMutantCache } from '../lib/mutant-cache.js';
import { withCommandBuildDir } from '../lib/command-build-dir.js';
import { projectUiProblem, requireGameProject } from '../lib/game-project.js';
import { chunkMdPath } from '../lib/project-paths.js';
import { gameTestRunProblem } from '../lib/test-run-scope.js';
import { discardRecord, runVitestRecorded, testRunVerdict } from '../lib/vitest-run.js';
import {
  VERIFY_CHECK_NAMES,
  CHUNK_VERIFY_CHECK_NAMES,
  type VerifyCheckName,
  type VerifyCheckOutcome,
  type VerifyCheckResult,
  type VerifyResult,
  buildVerifyResult,
  checkoutState,
  currentBoardsmithCommit,
  readVerifyResult,
  resultProblem,
  verifiedProblem,
  writeVerifyResult,
} from '../lib/verify-result.js';
import { isChunkCode, isTestFile, parseSpecManifest } from './test-step-check.js';
import { runSmoke } from './smoke.js';
import { runDiffMutationCheck } from './test-step-mutation.js';
import { buildProject } from './build.js';
import { type TypeCheckRun, typeCheckProject, validateProject } from './validate.js';
import { readIfExists } from '../lib/read-if-exists.js';

const short = (commit: string) => commit.slice(0, 12);

// -------------------------------------------------------------------------------------------
// What changed since the base
// -------------------------------------------------------------------------------------------

/**
 * The commit changes are measured from: the merge base of HEAD with `ref`, or with the main branch
 * when no ref is given. The merge base, not the ref itself, so commits the main branch gained after
 * this work started are not counted as this work's.
 */
export async function resolveBase(projectDir: string, ref: string | undefined): Promise<{ ref: string; commit: string }> {
  let name = ref;
  if (name === undefined) {
    for (const candidate of ['main', 'master']) {
      const found = await git(projectDir, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`]).catch(() => '');
      if (found.trim() !== '') {
        name = candidate;
        break;
      }
    }
    if (name === undefined) {
      throw new Error(
        'This repository has no main or master branch to measure the change from. ' +
          'Pass --base <git-ref>: the branch or commit this work started from.',
      );
    }
  }
  try {
    const commit = (await git(projectDir, ['merge-base', `${name}^{commit}`, 'HEAD'])).trim();
    return { ref: name, commit };
  } catch {
    throw new Error(
      `--base ${name} does not name a commit that shares history with HEAD in this repository. ` +
        'Pass the branch or commit this work started from, e.g. --base main.',
    );
  }
}

/**
 * The base a run measures from: `--chunk`'s verify base, else `resolveBase`. `given` says whether
 * the caller named it, since a base that is HEAD by default measures nothing (`mutationNotTried`).
 */
export async function runBase(projectDir: string, options: { base?: string; chunk?: string }): Promise<{ ref: string; commit: string; given: boolean }> {
  if (options.chunk === undefined) return { ...(await resolveBase(projectDir, options.base)), given: options.base !== undefined };
  if (options.base !== undefined) {
    throw new Error(
      `--chunk ${options.chunk} measures the change from where the chunk's work started, so --base does not apply. ` +
        'Pass one of them.',
    );
  }
  return { ref: `base of chunk-${options.chunk}`, commit: await chunkVerifyBase(projectDir, options.chunk), given: true };
}

/** Every file changed since the base, and the changed lines of each code file under `src/`. */
interface ChangedSince {
  files: string[];
  code: Map<string, Set<number>>;
}

/** The new-side lines a `@@ -a,b +c,d @@` hunk header covers, or undefined for any other line. */
function hunkLines(line: string): number[] | undefined {
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!hunk) return undefined;
  const start = Number(hunk[1]);
  const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
  return Array.from({ length: count }, (_, i) => start + i);
}

/** The new-side line numbers of the hunks in one file's zero-context diff. A deleted file has none. */
function addedLines(diff: string): Set<number> {
  return new Set(diff.split('\n').flatMap((line) => hunkLines(line) ?? []));
}

/**
 * What the working tree changes relative to `baseCommit`: committed since, staged, unstaged and
 * untracked. `code` holds only the files `isChunkCode` accepts, the ones the mutation check breaks.
 * Every path is relative to the project, and only the project's files count, so a game in a
 * subfolder of its repository is measured the same as one at the top.
 */
export async function changedSince(projectDir: string, baseCommit: string): Promise<ChangedSince> {
  // NUL-separated names are never quoted, so a name with a space, quote or backslash survives (#834).
  const status = (await git(projectDir, ['diff', '--relative', '--name-status', '-z', baseCommit, '--'])).split('\0').filter(Boolean);
  const untracked = (await git(projectDir, ['ls-files', '-z', '--others', '--exclude-standard'])).split('\0').filter(Boolean);

  // Each entry is a status then its path, or, for a rename or copy, the old path and the new one.
  const sources = new Map<string, string[]>();
  for (let i = 0; i < status.length; ) {
    const width = /^[RC]/.test(status[i]) ? 2 : 1;
    const paths = status.slice(i + 1, i + 1 + width);
    sources.set(paths[width - 1], paths);
    i += 1 + width;
  }
  const added = new Map<string, Set<number>>();
  for (const [path, paths] of sources) {
    if (!isChunkCode(path)) continue;
    const diff = await git(projectDir, ['--literal-pathspecs', 'diff', '--relative', '--no-color', '--no-ext-diff', '-U0', baseCommit, '--', ...paths]);
    added.set(path, addedLines(diff));
  }
  for (const path of untracked) {
    const text = await fs.readFile(join(projectDir, path), 'utf-8');
    added.set(path, new Set(text.replace(/\n$/, '').split('\n').map((_, i) => i + 1)));
  }
  const files = [...new Set([...sources.keys(), ...untracked])].sort();
  const code = new Map(
    [...added]
      .filter(([path, lines]) => isChunkCode(path) && lines.size > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return { files, code };
}

// -------------------------------------------------------------------------------------------
// The checks
// -------------------------------------------------------------------------------------------

/**
 * What a check is handed: the project, the commit checked out, the base (and whether `--base` named
 * it), what changed, and the checks already run.
 */
interface VerifyContext {
  projectDir: string;
  head: string;
  base: { ref: string; commit: string; given: boolean };
  /** The chunk `--chunk` named, whose fast checks run instead of the full ones (#985). */
  chunk?: string;
  changed: ChangedSince;
  /** Mutant outcomes of earlier runs, for this commit's code and tests (`lib/mutant-cache.ts`), opened on first ask. */
  mutantCache: () => Promise<MutantCache>;
  /** What changed in the execution context since the run began, or undefined while nothing has (#932). */
  contextChange: () => Promise<string | undefined>;
  /** Saves the mutant outcomes found so far, while the tree is still clean at the commit the run began on (#940). */
  saveMutantProgress: () => Promise<void>;
  earlier: ReadonlyMap<VerifyCheckName, VerifyCheckResult>;
  log: (line: string) => void;
  /**
   * The project's type check, run the first time a check asks and shared after that: the
   * `typecheck` check and `validate`'s TypeScript step report the same vue-tsc run (#532).
   */
  typeCheck: () => Promise<TypeCheckRun>;
}

type CheckRunner = (ctx: VerifyContext) => Promise<VerifyCheckOutcome>;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

interface VitestJsonReport {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  testResults: Array<{ name: string; status: string }>;
}

/** Where the failing test files are, relative to the files this change touched. */
function whereTestsFailed(failing: string[], changed: ReadonlySet<string>): string {
  const outside = failing.filter((f) => !changed.has(f));
  const inside = failing.filter((f) => changed.has(f));
  const files = (list: string[]) => `${list.length === 1 ? 'a file' : 'files'} you ${list === outside ? 'did not change' : 'changed'}: ${list.join(', ')}`;
  if (inside.length === 0) return files(outside);
  if (outside.length === 0) return files(inside);
  return `${files(outside)}; and in ${files(inside)}`;
}

/** Why the suite cannot run at all, as a failed check, or undefined when it can. */
async function suiteCannotRun(dir: string): Promise<VerifyCheckOutcome | undefined> {
  const problem = await gameTestRunProblem(dir);
  return problem === undefined ? undefined : { passed: false, summary: problem, next: 'Then run `boardsmith verify` again.' };
}

async function readJsonReport(path: string): Promise<VitestJsonReport | undefined> {
  const text = await readIfExists(path, (p) => fs.readFile(p, 'utf-8'));
  try {
    return text === undefined ? undefined : (JSON.parse(text) as VitestJsonReport);
  } catch {
    return undefined; // A report cut short says no more than none: the verdict comes from vitest's own.
  }
}

function suiteCounts(report: VitestJsonReport): Record<string, number> {
  return {
    files: report.testResults.length,
    tests: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests + report.numTodoTests,
  };
}

/** A failed run whose report names the failing files, said relative to what the change touched. */
function failedSuite(report: VitestJsonReport, failing: string[], changed: ReadonlySet<string>, suite: string): VerifyCheckOutcome {
  const tests = report.numFailedTests;
  const what = tests > 0 ? `${plural(tests, 'test')} failed` : `${plural(failing.length, 'test file')} could not run`;
  const one = failing.length === 1 && tests <= 1;
  return {
    passed: false,
    summary: `${what} in ${suite}, in ${whereTestsFailed(failing, changed)}.`,
    next: `Run \`boardsmith test\` to see ${one ? 'it' : 'them'}.`,
    counts: suiteCounts(report),
  };
}

/** The suite as `boardsmith test` runs it, or only `files` when given, plus a JSON report for the counts. */
function runSuite(dir: string, files: string[]) {
  return withCommandBuildDir(dir, 'verify', async (workDir) => {
    const reportPath = join(workDir, 'test-report.json');
    const run = await runVitestRecorded(['--reporter=json', `--outputFile.json=${reportPath}`, ...files], dir);
    const verdict = testRunVerdict(run, run.progress, { cwd: dir, logPath: run.logPath });
    return { run, verdict, report: await readJsonReport(reportPath) };
  });
}

/** A suite that did not pass: by failing file when the report names them, else by vitest's verdict. */
async function unpassedSuite(
  dir: string,
  verdict: string | undefined,
  report: VitestJsonReport | undefined,
  changed: ReadonlySet<string>,
  suite: string,
): Promise<VerifyCheckOutcome> {
  const root = await fs.realpath(dir);
  const failing = (report?.testResults ?? []).filter((f) => f.status === 'failed').map((f) => relative(root, f.name));
  if (report && failing.length > 0) return failedSuite(report, failing, changed, suite);
  return {
    passed: false,
    summary: (verdict ?? 'vitest passed but wrote no report, so the run cannot be counted.').split('\n').join(' '),
    next: 'Run `boardsmith test` to see the whole run.',
    ...(report ? { counts: suiteCounts(report) } : {}),
  };
}

/**
 * The tests a chunk's fast checks run (#985): the test files among `changed` (project-relative,
 * since the chunk's base `base`) that exist. With none, the outcome `noChunkTests` gives instead.
 * A step before spec that changed a file outside `design/` fails it first (#1201).
 * `--chunk` runs them on the chunk's commit, and chunk-merge on the combined tree (#987).
 */
export async function chunkTests(projectDir: string, chunk: string, base: string, changed: readonly string[]): Promise<string[] | VerifyCheckOutcome> {
  const early = await preSpecCodeChanges(projectDir, chunk);
  if (early.length > 0) {
    return {
      passed: false,
      summary:
        `Chunk "${chunk}" changed files outside design/ in a step before spec, which writes no game code: ` +
        `${early.map((e) => `${commitName(e.commit)} changed ${e.files.join(', ')}`).join('; ')}.`,
      next:
        'Commit game code under the step that writes it (spec or build), not investigate, redteam or ask: ' +
        'move those changes out of the commits named, commit, then run `boardsmith verify --chunk ' + chunk + '` again.',
    };
  }
  const files = changed.filter((path) => isTestFile(path) && existsSync(join(projectDir, path)));
  return files.length > 0 ? files : noChunkTests(projectDir, chunk, base);
}

/**
 * A chunk that added or changed no test file: it passes on typecheck alone while it has only reached
 * the steps before spec (#995), or when its Spec Manifest marks it exempt (`build/spec.md`
 * "Exemptions"); any other chunk must add or change a test.
 */
async function noChunkTests(projectDir: string, chunk: string, base: string): Promise<VerifyCheckOutcome> {
  if (await chunkBeforeSpec(projectDir, chunk)) {
    return {
      passed: true,
      summary: `No test ran: chunk "${chunk}" has only reached the steps before spec (investigate, redteam, ask), and spec writes its tests.`,
    };
  }
  const text = await readIfExists(chunkMdPath(projectDir, chunk), (path) => fs.readFile(path, 'utf-8'));
  const exemption = text === undefined ? undefined : parseSpecManifest(text).exemption;
  if (exemption !== undefined) {
    return {
      passed: true,
      summary:
        `No test ran: chunk "${chunk}" added or changed no test file, and its Spec Manifest marks it exempt ` +
        `("${exemption}"), so typecheck alone is its fast check.`,
    };
  }
  return {
    passed: false,
    summary: `Chunk "${chunk}" added or changed no test file since its base (${short(base)}), so no test of its own ran.`,
    next:
      `Write the chunk's tests (its spec step), or mark a chunk with no new game behavior exempt in its Spec Manifest ` +
      `(build/spec.md "Exemptions"), commit, then run \`boardsmith verify --chunk ${chunk}\` again.`,
  };
}

/** 1. The full suite, run the way `boardsmith test` runs it; with `--chunk`, the chunk's own test files. */
async function testCheck(ctx: VerifyContext): Promise<VerifyCheckOutcome> {
  const cannot = await suiteCannotRun(ctx.projectDir);
  if (cannot) return cannot;
  const files = ctx.chunk === undefined ? [] : await chunkTests(ctx.projectDir, ctx.chunk, ctx.base.commit, ctx.changed.files);
  if (!Array.isArray(files)) return files;
  const suite = ctx.chunk === undefined ? 'the full suite' : "the chunk's tests";
  // Real absolute paths, as vitest names test files, so its filename filter matches only these.
  const root = await fs.realpath(ctx.projectDir);
  const { run, verdict, report } = await runSuite(ctx.projectDir, files.map((path) => join(root, path)));
  if (verdict !== undefined || !report) return unpassedSuite(ctx.projectDir, verdict, report, new Set(ctx.changed.files), suite);
  discardRecord(run);
  const counts = suiteCounts(report);
  const where = ctx.chunk === undefined ? plural(counts.files, 'file') : `${plural(counts.files, 'file')} the chunk added or changed`;
  return { passed: true, summary: `${plural(counts.passed, 'test')} passed in ${where}.`, counts };
}

/** 2. vue-tsc over the project's tsconfig.json, the run `validate` reports too. */
async function typecheckCheck(ctx: VerifyContext): Promise<VerifyCheckOutcome> {
  const { result, compilerReport } = await ctx.typeCheck();
  if (result.passed) return { passed: true, summary: 'No type errors.' };
  for (const line of compilerReport) console.log(line);
  return { passed: false, summary: `${result.message}.`, next: 'Fix the errors above, then run `boardsmith verify` again.' };
}

/** 3. `boardsmith build`, run in this process. */
async function buildCheck(ctx: VerifyContext): Promise<VerifyCheckOutcome> {
  const noUi = noUiOutcome(ctx.projectDir);
  if (noUi) return noUi;
  try {
    await buildProject(ctx.projectDir, {});
    return { passed: true, summary: '`boardsmith build` passed.' };
  } catch (error) {
    console.log(styleText('red', (error as Error).message));
    return { passed: false, summary: '`boardsmith build` failed.', next: 'Run `boardsmith build` to see why.' };
  }
}

/** 4. `boardsmith validate`, run in this process on the type check the run already has. */
async function validateCheck(ctx: VerifyContext): Promise<VerifyCheckOutcome> {
  try {
    await validateProject(ctx.projectDir, { typeCheck: await ctx.typeCheck() });
    return { passed: true, summary: '`boardsmith validate` passed.' };
  } catch (error) {
    console.log(styleText('red', (error as Error).message));
    return { passed: false, summary: '`boardsmith validate` failed.', next: 'Run `boardsmith validate` to see why.' };
  }
}

const NO_MUTANTS = Object.freeze({ files: 0, mutants: 0, killed: 0, survived: 0, timedOut: 0, equivalent: 0, unreached: 0, reused: 0 });

/** Why no mutant is tried at all (nothing measured, nothing changed, a red suite), or undefined. */
function mutationNotTried(ctx: VerifyContext, since: string): VerifyCheckOutcome | undefined {
  if (!ctx.base.given && ctx.base.commit === ctx.head) {
    // On the main branch itself (a chunk built in the main checkout) the merge base is HEAD, so the
    // default base measures no change at all, and a pass would cover nothing.
    return {
      passed: false,
      summary:
        `The merge base with ${ctx.base.ref} is the current commit (${short(ctx.head)}), so no change is measured ` +
        'and there is nothing to mutate. A pass here would cover nothing.',
      next: 'Run `boardsmith verify --base <commit the work started from>`: the commit before the first commit of this work.',
      counts: { ...NO_MUTANTS },
    };
  }
  if (ctx.changed.code.size === 0) {
    return { passed: true, summary: `No code under src/ changed since ${since}, so there was nothing to mutate.`, counts: { ...NO_MUTANTS } };
  }
  if (!ctx.earlier.get('test')?.passed) {
    return {
      passed: false,
      summary: 'Not run: the full suite is not green, and a mutant proves nothing on a red suite.',
      next: 'Fix the test check first, then run `boardsmith verify` again.',
      counts: { ...NO_MUTANTS },
    };
  }
  return undefined;
}

type DiffMutationRun = Awaited<ReturnType<typeof runDiffMutationCheck>>;

/** What to say of the mutants no test caught (`of` places their count) and of those in a file no test loads, and what to do. */
function unresolvedMutants(of: string, survivors: DiffMutationRun['survivors'], unreached: DiffMutationRun['unreached']) {
  const said: string[] = [];
  const next: string[] = [];
  if (survivors.length > 0) {
    said.push(`${survivors.length} ${of} survived: every test that loads its file still passed with the code changed`);
    next.push(
      'For each survivor, add or tighten a test so it fails when that line is changed that way, then run `boardsmith verify` again. ' +
        'For a demonstrated equivalent under an explicit valid-input contract, use `boardsmith mutation-equivalence <id> --contract <text> --proof <text>` with the same --base, review the ledger and commit it with `git commit -S`.',
    );
  }
  if (unreached.length > 0) {
    said.push(`${unreached.length} ${of} were in a file no test loads, so no test could notice the change`);
    next.push('For each file no test loads, add a test that imports it and checks what the changed lines do, then run `boardsmith verify` again.');
  }
  return {
    summary: said.join('; '),
    next: next.join(' '),
    findings: [
      ...survivors.map((s) => ({ file: s.file, line: s.line, detail: `${s.description}: no test failed`, ...(s.id ? { mutantId: s.id } : {}) })),
      ...unreached.map((u) => ({ file: u.file, line: u.line, detail: `${u.description}: no test loads ${u.file}` })),
    ],
  };
}

/** What a finished mutation run says: a red suite under the runner, survivors or mutants no test loads, or every mutant caught. */
function mutationVerdict(since: string, run: DiffMutationRun): VerifyCheckOutcome {
  const { summary, reused, survivors, unreached, notGreen, equivalence } = run;
  const counts = { ...summary, reused };
  const reuse = reused > 0 ? ` ${reused} reused from an earlier run of this same code and these same tests.` : '';
  if (notGreen) {
    return {
      passed: false,
      summary: `The suite did not pass under the mutation runner before any mutant was tried: ${notGreen.join('; ')}.`,
      next: 'Run `boardsmith test` to see why, fix it, then run `boardsmith verify` again.',
      counts,
    };
  }
  if (summary.mutants === 0) {
    return { passed: true, summary: `No line changed since ${since} holds code a mutant can change.`, counts };
  }
  if (survivors.length > 0 || unreached.length > 0) {
    const unresolved = unresolvedMutants(`of ${plural(summary.mutants, 'mutant')} of the lines changed since ${since}`, survivors, unreached);
    return { passed: false, ...unresolved, summary: `${unresolved.summary}.${reuse}`, counts, ...(equivalence ? { equivalence } : {}) };
  }
  const dispositions = `${summary.killed} killed by tests, ${summary.equivalent} reviewed equivalent, ${summary.timedOut} timed out`;
  return {
    passed: true,
    summary: `${plural(summary.mutants, 'mutant')} of the lines changed since ${since}: ${dispositions}; no unresolved survivors.${reuse}`,
    counts,
    ...(equivalence ? { equivalence } : {}),
  };
}

/** 6. Every mutant of a changed code line must make a test that loads its file fail. */
async function mutationCheck(ctx: VerifyContext): Promise<VerifyCheckOutcome> {
  const since = `${ctx.base.ref} (${short(ctx.base.commit)})`;
  const notTried = mutationNotTried(ctx, since);
  if (notTried) return notTried;
  const run = await runDiffMutationCheck({
    projectDir: ctx.projectDir,
    added: ctx.changed.code,
    cache: await ctx.mutantCache(),
    log: ctx.log,
    contextChange: ctx.contextChange,
    saveProgress: ctx.saveMutantProgress,
  });
  return mutationVerdict(since, run);
}

/** 5. The game in Chromium, served by `boardsmith dev` from a fresh copy (`smoke.ts`). */
async function smokeCheck(ctx: VerifyContext): Promise<VerifyCheckOutcome> {
  return noUiOutcome(ctx.projectDir) ?? (await runSmoke({ projectDir: ctx.projectDir, log: ctx.log })).outcome;
}

/**
 * `build` and `smoke` need a UI, so in a project with none yet (`boardsmith init --sim`) they are
 * skipped rather than failed, and the result says so. A table that lost `index.html` but kept its
 * other UI files fails them. Undefined when the project has a UI.
 */
function noUiOutcome(projectDir: string): VerifyCheckOutcome | undefined {
  const config = JSON.parse(readFileSync(join(projectDir, 'boardsmith.json'), 'utf-8')) as { backend?: unknown };
  const ui = projectUiProblem(projectDir, config);
  if (ui === undefined) return undefined;
  if (ui.state === 'broken') return { passed: false, summary: ui.problem };
  return {
    passed: true,
    skipped: true,
    summary: 'Skipped: this project has no UI yet (no index.html); run `boardsmith add-ui`.',
  };
}

/** The checks a result skipped, as a clause for a closing line, or '' when none was. */
function skippedClause(result: VerifyResult): string {
  const skipped = result.checks.filter((c) => c.skipped).map((c) => c.name);
  return skipped.length === 0 ? '' : `, except ${skipped.join(' and ')}, skipped because this project has no UI yet`;
}

/** Every check, by name. Adding a name to `VERIFY_CHECK_NAMES` requires its runner here. */
export const VERIFY_CHECKS: Readonly<Record<VerifyCheckName, CheckRunner>> = Object.freeze({
  test: testCheck,
  typecheck: typecheckCheck,
  build: buildCheck,
  validate: validateCheck,
  smoke: smokeCheck,
  mutation: mutationCheck,
});

// -------------------------------------------------------------------------------------------
// Running them
// -------------------------------------------------------------------------------------------

/**
 * The result lives under `.boardsmith/`, which a game's `.gitignore` leaves out of git. Where it does
 * not, writing the result would itself make the tree dirty, and no result could ever count.
 */
async function requireResultIgnored(projectDir: string): Promise<void> {
  const ignored = await gitSucceeds(projectDir, ['check-ignore', '-q', '--no-index', '.boardsmith/verify/result.json']);
  if (!ignored) {
    throw new Error(
      "This project's .gitignore does not leave .boardsmith/ out of git, so the result `boardsmith verify` writes " +
        'there would itself be an uncommitted change. Add `.boardsmith/` to .gitignore (`boardsmith init` writes it), ' +
        'commit, then run `boardsmith verify`.',
    );
  }
}

/**
 * The commit checked out in `projectDir`, when it can be verified as it stands. A result is tied to
 * a commit, so uncommitted or untracked changes are refused here, before any check runs.
 */
export async function verifiableCommit(projectDir: string): Promise<string> {
  const state = await checkoutState(projectDir);
  if ('problem' in state) throw new Error(state.problem);
  if (!state.clean) {
    throw new Error(
      'The working tree has uncommitted changes, and a `boardsmith verify` result is tied to a commit, so no check was run. ' +
        'Commit your work (`git status` lists the changes), then run `boardsmith verify`.',
    );
  }
  return state.commit;
}

/**
 * Writes `result`, so the latest clean run of a commit is the one on file, failing or passing. The
 * one run kept out is one whose tree did not stay clean, when a clean, passing result for the same
 * commit is already on file: that run says nothing about the commit as committed. It is still
 * printed and still exits non-zero. Returns where the result was written, or undefined when it was
 * kept out.
 */
async function recordResult(projectDir: string, result: VerifyResult): Promise<string | undefined> {
  if (!result.cleanTree) {
    const onFile = await readVerifyResult(projectDir, result.commit);
    if (onFile !== undefined && onFile !== 'unreadable' && resultProblem(onFile, result.commit) === undefined) return undefined;
  }
  return writeVerifyResult(projectDir, result);
}

/** Runs every check in order, each whether or not an earlier one failed. A check that throws failed. */
async function runChecks(
  checks: Readonly<Record<VerifyCheckName, CheckRunner>>,
  ctx: Omit<VerifyContext, 'earlier'>,
  names: readonly VerifyCheckName[] = VERIFY_CHECK_NAMES,
): Promise<VerifyCheckResult[]> {
  const earlier = new Map<VerifyCheckName, VerifyCheckResult>();
  for (const name of names) {
    console.log(styleText('cyan', `\nboardsmith verify: ${name}\n`));
    let outcome: VerifyCheckOutcome;
    try {
      outcome = await checks[name]({ ...ctx, earlier });
    } catch (error) {
      outcome = {
        passed: false,
        summary: `The ${name} check could not run: ${(error as Error).message}`,
        next: 'Fix what it names, then run `boardsmith verify` again.',
      };
    }
    earlier.set(name, { name, ...outcome });
  }
  return [...earlier.values()];
}

/**
 * Runs every check and records the result for the commit checked out. A dirty tree is refused
 * before anything runs. `checks` is for tests that stand in for a check a fixture cannot run.
 */
export async function runVerify(options: {
  projectDir: string;
  base?: string;
  chunk?: string;
  checks?: Readonly<Record<VerifyCheckName, CheckRunner>>;
  log?: (line: string) => void;
}): Promise<{ result: VerifyResult; path: string | undefined }> {
  const projectDir = pathResolve(options.projectDir);
  requireGameProject(projectDir);
  const head = await verifiableCommit(projectDir);
  await requireResultIgnored(projectDir);
  const base = await runBase(projectDir, options);
  const log = options.log ?? ((line: string) => console.error(styleText('dim', line)));
  // One capture for the whole run: the mutant cache keys by it, and it is checked again at the end.
  const context = await captureExecutionContext(projectDir);
  const contextChange = () => executionContextChange(projectDir, context);
  const boardsmithCommit = await currentBoardsmithCommit();
  // Only the mutation check reads the cache, so a run without it (`--chunk`) never opens it.
  let mutantCache: Promise<MutantCache> | undefined;
  const openCache = () => (mutantCache ??= openMutantCache(projectDir, context).then((cache) => {
    if (cache.unavailable !== undefined) log(`${cache.unavailable}; every mutant runs.`);
    return cache;
  }));
  const saveMutantProgress = async () => {
    if (mutantCache === undefined) return;
    if (cleanAt(await checkoutState(projectDir), head)) await (await mutantCache).save();
  };
  let typeCheck: Promise<TypeCheckRun> | undefined;
  const checks = await runChecks(options.checks ?? VERIFY_CHECKS, {
    projectDir,
    typeCheck: () => (typeCheck ??= typeCheckProject(projectDir)),
    head,
    base,
    chunk: options.chunk,
    changed: await changedSince(projectDir, base.commit),
    mutantCache: openCache,
    contextChange,
    saveMutantProgress,
    log,
  }, options.chunk === undefined ? VERIFY_CHECK_NAMES : CHUNK_VERIFY_CHECK_NAMES);

  const change = await contextChange();
  if (change !== undefined) {
    throw new Error(
      `What the tests run with changed while \`boardsmith verify\` ran: ${change}. Checks after the change ran against ` +
        'different code, so no result was recorded and no mutant outcome found after the change was saved. Run `boardsmith verify` again in a ' +
        'checkout whose BoardSmith and installed packages stay unchanged until it finishes, such as a separate BoardSmith worktree nothing else edits.',
    );
  }
  const cleanTree = cleanAt(await checkoutState(projectDir), head);
  // The cache keys outcomes by the commit's files; a run whose files changed under it keeps none.
  if (cleanTree && mutantCache !== undefined) await (await mutantCache).save();
  const result = buildVerifyResult({
    commit: head,
    cleanTree,
    base: { ref: base.ref, commit: base.commit },
    chunk: options.chunk,
    checks,
    boardsmithCommit,
  });
  return { result, path: await recordResult(projectDir, result) };
}

/** Whether the checkout is clean and still at `head`, the commit the run verifies. */
function cleanAt(state: Awaited<ReturnType<typeof checkoutState>>, head: string): boolean {
  return !('problem' in state) && state.clean && state.commit === head;
}

/** The closing line: whether the run counts, and if not, what to do. */
function printVerdict(result: VerifyResult): void {
  if (!result.cleanTree) {
    console.error(
      styleText('red',
        '\nThe working tree changed while the checks ran, so this run does not count for a done claim. ' +
          'Commit or remove the changes (`git status` lists them), then run `boardsmith verify` again.',
      ),
    );
  } else if (result.passed && result.chunk !== null) {
    console.log(
      styleText('green',
        `\nFast checks passed for ${short(result.commit)}: chunk "${result.chunk}"'s tests and typecheck. ` +
          'The full suite, build, validate, smoke and mutation checks run at publish (`boardsmith verify`).',
      ),
    );
  } else if (result.passed && skippedClause(result) !== '') {
    console.log(styleText('yellow', `\nPassed for ${short(result.commit)}${skippedClause(result)}.`));
  } else if (result.passed) {
    console.log(styleText('green', `\nEvery check passed for ${short(result.commit)}.`));
  } else {
    const failed = result.checks.filter((c) => !c.passed).map((c) => c.name);
    console.error(styleText('red', `\nFailed: ${failed.join(', ')}. Fix what each names above, commit, and run \`boardsmith verify\` again.`));
  }
}

function printCheck(check: VerifyCheckResult): void {
  const mark = check.skipped ? styleText('yellow', 'skip') : check.passed ? styleText('green', 'pass') : styleText('red', 'FAIL');
  console.log(`  ${mark}  ${check.name.padEnd(10)} ${check.summary}`);
  for (const f of check.findings ?? []) {
    console.log(`          ${f.file}:${f.line}  ${f.detail}`);
    if (f.mutantId) console.log(`          equivalence candidate ID: ${f.mutantId}`);
  }
  if (!check.passed && check.next) console.log(`          ${check.next}`);
}

function printResult(result: VerifyResult, path: string | undefined, projectDir: string): void {
  console.log(`\nboardsmith verify for ${short(result.commit)} (changes since ${result.base.ref} at ${short(result.base.commit)})`);
  result.checks.forEach(printCheck);
  console.log(
    path === undefined
      ? `Result: not recorded, because the tree changed while this run checked it; the clean, passing result already on file for ${short(result.commit)} stands.`
      : `Result: ${relative(projectDir, path)}`,
  );
  printVerdict(result);
}

/** `--check`: says whether HEAD has a passing result, naming any check it skipped. */
async function checkVerified(projectDir: string, chunk: string | undefined): Promise<void> {
  const problem = await verifiedProblem(projectDir, chunk);
  if (problem !== undefined) {
    console.error(styleText('red', problem));
    process.exitCode = 1;
    return;
  }
  const state = await checkoutState(projectDir);
  const head = 'commit' in state ? short(state.commit) : 'HEAD';
  const onFile = 'commit' in state ? await readVerifyResult(projectDir, state.commit) : undefined;
  const skipped = onFile === undefined || onFile === 'unreadable' ? '' : skippedClause(onFile);
  const ran = chunk === undefined ? '`boardsmith verify`' : `\`boardsmith verify --chunk ${chunk}\` (the chunk's tests and typecheck)`;
  console.log(styleText('green', `${head} passed ${ran} on a clean tree${skipped}.`));
}

/**
 * `boardsmith verify [--base <ref> | --chunk <slug>] [--check] [--project <dir>]`. Throws (a clean
 * one-line message through cli.ts) when it cannot run at all; sets a non-zero exit code when a
 * check fails, when the tree was not clean, or, with `--check`, when HEAD is not verified.
 */
export async function verifyCommand(
  options: { base?: string; chunk?: string; check?: boolean; project?: string },
  checks: Readonly<Record<VerifyCheckName, CheckRunner>> = VERIFY_CHECKS,
): Promise<void> {
  const projectDir = pathResolve(options.project ?? process.cwd());
  if (options.check) {
    if (options.base !== undefined) {
      throw new Error(
        '--check reads the result on file and runs nothing, so --base does not apply. ' +
          'Run `boardsmith verify --check`, with `--chunk <slug>` for a chunk.',
      );
    }
    await checkVerified(projectDir, options.chunk);
    return;
  }

  const { result, path } = await runVerify({ projectDir, base: options.base, chunk: options.chunk, checks });
  printResult(result, path, projectDir);
  if (!result.passed || !result.cleanTree) process.exitCode = 1;
}
