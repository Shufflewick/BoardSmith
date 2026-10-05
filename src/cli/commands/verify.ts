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
 *   2. typecheck  `boardsmith typecheck`
 *   3. build      `boardsmith build`
 *   4. validate   `boardsmith validate`
 *   5. smoke      `tests/browser/smoke.spec.ts` in Chromium against `boardsmith dev`, served from a
 *                 fresh copy of the project (`smoke.ts`): a seated player takes every offered action
 *                 and presses every board control, and any page error, console error, failed
 *                 request or failed action fails it
 *   6. mutation   every code line under `src/` changed since the base, broken one small change at a
 *                 time; the whole suite must fail for each (`runDiffMutationCheck`). An outcome from
 *                 an earlier run of the same code and tests is reused (`lib/mutant-cache.ts`), so a
 *                 re-verify after a bookkeeping-only commit runs no mutant again. The cache is shared
 *                 by every worktree, so a merge reuses what a worktree ran when the merged tree is
 *                 the one it verified (main has not moved, or the branch merged main and verified).
 *
 * The base is the merge base of HEAD with `--base`, or with the main branch (`main`, else `master`).
 * On the main branch itself that merge base is HEAD, which measures no change, so without `--base`
 * the mutation check fails there and says to pass the commit the work started from. For chunk work
 * `--chunk <slug>` sets the base to the chunk's verify base, the commit before its first
 * `chunk-<slug>/` commit (`lib/chunk-commits.ts`), wherever the chunk is built, and records the
 * chunk in the result.
 *
 * A tree with uncommitted changes is refused before any check runs: a result is tied to a commit.
 * The result goes to `.boardsmith/verify/<commit>.json` (`lib/verify-result.ts`), with whether the
 * tree stayed clean while the checks ran. The exit code is non-zero when any check failed, and also
 * when the tree changed during the run; such a run never replaces a clean passing result on file.
 *
 * `--check` runs nothing. It exits 0 only when HEAD, on a clean tree, has a passing result, and
 * otherwise says what to run. With `--chunk <slug>` the result must also have measured that chunk's
 * whole change: its base is the chunk's verify base or a commit before it, so a `--base HEAD` run,
 * which mutates nothing, cannot stand in for it. `chunk-signoff <slug>` asks that question, and
 * `chunk-gate-transition`, which builds no chunk, the plain one (`verifiedProblem`).
 */
import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { join, relative, resolve as pathResolve } from 'node:path';
import chalk from 'chalk';
import { boardsmithPackageRoot } from '../lib/boardsmith-version.js';
import { chunkVerifyBase } from '../lib/chunk-commits.js';
import { gitOutput as git, gitSucceeds } from '../lib/git-output.js';
import { type MutantCache, openMutantCache } from '../lib/mutant-cache.js';
import { scratchDir } from '../lib/project-paths.js';
import { testRunScopeProblem } from '../lib/test-run-scope.js';
import { discardRecord, runVitestRecorded, testRunVerdict } from '../lib/vitest-run.js';
import {
  VERIFY_CHECK_NAMES,
  type VerifyCheckName,
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
import { isChunkCode } from './test-step-check.js';
import { runSmoke } from './smoke.js';
import { runDiffMutationCheck } from './test-step-mutation.js';
import { runTypecheck } from './typecheck.js';

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
async function runBase(projectDir: string, options: { base?: string; chunk?: string }): Promise<{ ref: string; commit: string; given: boolean }> {
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

/** The new-side line numbers of each hunk in a zero-context diff, by file. A deleted file has none. */
function addedLinesByFile(diff: string): Map<string, Set<number>> {
  const byFile = new Map<string, Set<number>>();
  let current = new Set<number>();
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      current = new Set();
      if (line !== '+++ /dev/null') byFile.set(line.slice(4).replace(/^b\//, ''), current);
      continue;
    }
    hunkLines(line)?.forEach((n) => current.add(n));
  }
  return byFile;
}

/**
 * What the working tree changes relative to `baseCommit`: committed since, staged, unstaged and
 * untracked. `code` holds only the files `isChunkCode` accepts, the ones the mutation check breaks.
 * Every path is relative to the project, and only the project's files count, so a game in a
 * subfolder of its repository is measured the same as one at the top.
 */
export async function changedSince(projectDir: string, baseCommit: string): Promise<ChangedSince> {
  const prefixes = ['--relative', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
  const diff = await git(projectDir, ['diff', ...prefixes, '-U0', baseCommit, '--']);
  const named = await git(projectDir, ['diff', '--relative', '--name-only', baseCommit, '--']);
  const untracked = (await git(projectDir, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean);

  const added = addedLinesByFile(diff);
  for (const path of untracked) {
    const text = await fs.readFile(join(projectDir, path), 'utf-8');
    added.set(path, new Set(text.replace(/\n$/, '').split('\n').map((_, i) => i + 1)));
  }
  const files = [...new Set([...named.split('\n').filter(Boolean), ...untracked])].sort();
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
  changed: ChangedSince;
  /** Mutant outcomes of earlier runs, for this commit's code and tests (`lib/mutant-cache.ts`). */
  mutantCache: MutantCache;
  earlier: ReadonlyMap<VerifyCheckName, VerifyCheckResult>;
  log: (line: string) => void;
}

type CheckOutcome = Omit<VerifyCheckResult, 'name'>;
type CheckRunner = (ctx: VerifyContext) => Promise<CheckOutcome>;

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
async function suiteCannotRun(dir: string): Promise<CheckOutcome | undefined> {
  if (!existsSync(join(dir, 'tests'))) {
    return {
      passed: false,
      summary: 'This project has no tests/ directory, so nothing tests it.',
      next: "Write the game's tests under tests/, then run `boardsmith verify` again.",
    };
  }
  const scope = await testRunScopeProblem(dir);
  return scope === undefined ? undefined : { passed: false, summary: scope, next: 'Then run `boardsmith verify` again.' };
}

async function readJsonReport(path: string): Promise<VitestJsonReport | undefined> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf-8')) as VitestJsonReport;
  } catch {
    return undefined;
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

/** A failed suite whose report names the failing files, said relative to what the change touched. */
function failedSuite(report: VitestJsonReport, failing: string[], changed: ReadonlySet<string>): CheckOutcome {
  const tests = report.numFailedTests;
  const what = tests > 0 ? `${plural(tests, 'test')} failed` : `${plural(failing.length, 'test file')} could not run`;
  const one = failing.length === 1 && tests <= 1;
  return {
    passed: false,
    summary: `${what} in the full suite, in ${whereTestsFailed(failing, changed)}.`,
    next: `Run \`boardsmith test\` to see ${one ? 'it' : 'them'}.`,
    counts: suiteCounts(report),
  };
}

/** The full suite as `boardsmith test` runs it, plus a JSON report for the counts. */
async function runSuite(dir: string) {
  const workDir = join(scratchDir(dir), 'verify');
  const reportPath = join(workDir, 'test-report.json');
  await fs.mkdir(workDir, { recursive: true });
  await fs.rm(reportPath, { force: true });
  const run = await runVitestRecorded(['--reporter=json', `--outputFile.json=${reportPath}`], dir);
  const verdict = testRunVerdict(run, run.progress, { cwd: dir, logPath: run.logPath });
  const report = await readJsonReport(reportPath);
  await fs.rm(workDir, { recursive: true, force: true });
  return { run, verdict, report };
}

/** A suite that did not pass: by failing file when the report names them, else by vitest's verdict. */
async function unpassedSuite(
  dir: string,
  verdict: string | undefined,
  report: VitestJsonReport | undefined,
  changed: ReadonlySet<string>,
): Promise<CheckOutcome> {
  const root = await fs.realpath(dir);
  const failing = (report?.testResults ?? []).filter((f) => f.status === 'failed').map((f) => relative(root, f.name));
  if (report && failing.length > 0) return failedSuite(report, failing, changed);
  return {
    passed: false,
    summary: (verdict ?? 'vitest passed but wrote no report, so the run cannot be counted.').split('\n').join(' '),
    next: 'Run `boardsmith test` to see the whole run.',
    ...(report ? { counts: suiteCounts(report) } : {}),
  };
}

/** 1. The full suite, run the way `boardsmith test` runs it. */
async function testCheck(ctx: VerifyContext): Promise<CheckOutcome> {
  const cannot = await suiteCannotRun(ctx.projectDir);
  if (cannot) return cannot;
  const { run, verdict, report } = await runSuite(ctx.projectDir);
  if (verdict !== undefined || !report) return unpassedSuite(ctx.projectDir, verdict, report, new Set(ctx.changed.files));
  discardRecord(run);
  const counts = suiteCounts(report);
  return { passed: true, summary: `${plural(counts.passed, 'test')} passed in ${plural(counts.files, 'file')}.`, counts };
}

/** 2. `boardsmith typecheck`: vue-tsc over the project's tsconfig.json. */
async function typecheckCheck(ctx: VerifyContext): Promise<CheckOutcome> {
  const code = await runTypecheck(ctx.projectDir);
  return code === 0
    ? { passed: true, summary: 'No type errors.' }
    : { passed: false, summary: `vue-tsc found type errors (exit code ${code}).`, next: 'Run `boardsmith typecheck` to see them.' };
}

/**
 * Runs `boardsmith <command>` in the project as a separate process, as a user would, and reports
 * how it exited. `build` and `validate` end the process they run in when they fail, so they cannot
 * run inside this one.
 */
function cliCheck(command: 'build' | 'validate'): CheckRunner {
  return async (ctx) => {
    const bin = join(boardsmithPackageRoot(), 'bin', 'boardsmith.js');
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, [bin, command], { cwd: ctx.projectDir, stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', resolve);
    });
    return code === 0
      ? { passed: true, summary: `\`boardsmith ${command}\` passed.` }
      : {
          passed: false,
          summary: `\`boardsmith ${command}\` failed (exit code ${code}).`,
          next: `Run \`boardsmith ${command}\` to see why.`,
        };
  };
}

const NO_MUTANTS = Object.freeze({ files: 0, mutants: 0, killed: 0, survived: 0, timedOut: 0, reused: 0 });

/** Why no mutant is tried at all (nothing measured, nothing changed, a red suite), or undefined. */
function mutationNotTried(ctx: VerifyContext, since: string): CheckOutcome | undefined {
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

/** What a finished mutation run says: a red suite under the runner, survivors, or every mutant caught. */
function mutationVerdict(since: string, run: Awaited<ReturnType<typeof runDiffMutationCheck>>): CheckOutcome {
  const { summary, reused, survivors, notGreen } = run;
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
  if (survivors.length > 0) {
    return {
      passed: false,
      summary:
        `${survivors.length} of ${plural(summary.mutants, 'mutant')} of the lines changed since ${since} survived: ` +
        `the whole suite still passed with the code changed.${reuse}`,
      next:
        'For each one, add or tighten a test so it fails when that line is changed that way, then run `boardsmith verify` again.',
      counts,
      findings: survivors.map((s) => ({ file: s.file, line: s.line, detail: `${s.description}: no test failed` })),
    };
  }
  const timedOut = summary.timedOut > 0 ? ` (${summary.timedOut} by running past the time limit)` : '';
  return {
    passed: true,
    summary: `Every one of ${plural(summary.mutants, 'mutant')} of the lines changed since ${since} made a test fail${timedOut}.${reuse}`,
    counts,
  };
}

/** 6. Every mutant of a changed code line must make the whole suite fail. */
async function mutationCheck(ctx: VerifyContext): Promise<CheckOutcome> {
  const since = `${ctx.base.ref} (${short(ctx.base.commit)})`;
  const notTried = mutationNotTried(ctx, since);
  if (notTried) return notTried;
  const run = await runDiffMutationCheck({
    projectDir: ctx.projectDir,
    added: ctx.changed.code,
    cache: ctx.mutantCache,
    log: ctx.log,
  });
  return mutationVerdict(since, run);
}

/** 5. The game in Chromium, served by `boardsmith dev` from a fresh copy (`smoke.ts`). */
async function smokeCheck(ctx: VerifyContext): Promise<CheckOutcome> {
  return (await runSmoke({ projectDir: ctx.projectDir, log: ctx.log })).outcome;
}

/** Every check, by name. Adding a name to `VERIFY_CHECK_NAMES` requires its runner here. */
export const VERIFY_CHECKS: Readonly<Record<VerifyCheckName, CheckRunner>> = Object.freeze({
  test: testCheck,
  typecheck: typecheckCheck,
  build: cliCheck('build'),
  validate: cliCheck('validate'),
  smoke: smokeCheck,
  mutation: mutationCheck,
});

// -------------------------------------------------------------------------------------------
// Running them
// -------------------------------------------------------------------------------------------

function requireGameProject(projectDir: string): void {
  if (!existsSync(join(projectDir, 'boardsmith.json'))) {
    throw new Error(
      `boardsmith verify checks a game project, and ${projectDir} has no boardsmith.json. ` +
        "Run it in the game's directory, or pass --project <dir>.",
    );
  }
}

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
async function verifiableCommit(projectDir: string): Promise<string> {
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
): Promise<VerifyCheckResult[]> {
  const earlier = new Map<VerifyCheckName, VerifyCheckResult>();
  for (const name of VERIFY_CHECK_NAMES) {
    console.log(chalk.cyan(`\nboardsmith verify: ${name}\n`));
    let outcome: CheckOutcome;
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
  const mutantCache = await openMutantCache(projectDir);
  const log = options.log ?? ((line: string) => console.error(chalk.dim(line)));
  if (mutantCache.unavailable !== undefined) log(`${mutantCache.unavailable}; every mutant runs.`);
  const checks = await runChecks(options.checks ?? VERIFY_CHECKS, {
    projectDir,
    head,
    base,
    changed: await changedSince(projectDir, base.commit),
    mutantCache,
    log,
  });

  const after = await checkoutState(projectDir);
  const cleanTree = !('problem' in after) && after.clean && after.commit === head;
  // The cache keys outcomes by the commit's files; a run whose files changed under it keeps none.
  if (cleanTree) await mutantCache.save();
  const result = buildVerifyResult({
    commit: head,
    cleanTree,
    base: { ref: base.ref, commit: base.commit },
    chunk: options.chunk,
    checks,
    boardsmithCommit: await currentBoardsmithCommit(),
  });
  return { result, path: await recordResult(projectDir, result) };
}

/** The closing line: whether the run counts, and if not, what to do. */
function printVerdict(result: VerifyResult): void {
  if (!result.cleanTree) {
    console.error(
      chalk.red(
        '\nThe working tree changed while the checks ran, so this run does not count for a done claim. ' +
          'Commit or remove the changes (`git status` lists them), then run `boardsmith verify` again.',
      ),
    );
  } else if (result.passed) {
    console.log(chalk.green(`\nEvery check passed for ${short(result.commit)}.`));
  } else {
    const failed = result.checks.filter((c) => !c.passed).map((c) => c.name);
    console.error(chalk.red(`\nFailed: ${failed.join(', ')}. Fix what each names above, commit, and run \`boardsmith verify\` again.`));
  }
}

function printResult(result: VerifyResult, path: string | undefined, projectDir: string): void {
  console.log(`\nboardsmith verify for ${short(result.commit)} (changes since ${result.base.ref} at ${short(result.base.commit)})`);
  for (const check of result.checks) {
    const mark = check.passed ? chalk.green('pass') : chalk.red('FAIL');
    console.log(`  ${mark}  ${check.name.padEnd(10)} ${check.summary}`);
    for (const f of check.findings ?? []) console.log(`          ${f.file}:${f.line}  ${f.detail}`);
    if (!check.passed && check.next) console.log(`          ${check.next}`);
  }
  console.log(
    path === undefined
      ? `Result: not recorded, because the tree changed while this run checked it; the clean, passing result already on file for ${short(result.commit)} stands.`
      : `Result: ${relative(projectDir, path)}`,
  );
  printVerdict(result);
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
    const problem = await verifiedProblem(projectDir, options.chunk);
    if (problem !== undefined) {
      console.error(chalk.red(problem));
      process.exitCode = 1;
      return;
    }
    const state = await checkoutState(projectDir);
    const head = 'commit' in state ? short(state.commit) : 'HEAD';
    const covering = options.chunk === undefined ? '' : `, covering chunk "${options.chunk}"'s change`;
    console.log(chalk.green(`${head} passed \`boardsmith verify\` on a clean tree${covering}.`));
    return;
  }

  const { result, path } = await runVerify({ projectDir, base: options.base, chunk: options.chunk, checks });
  printResult(result, path, projectDir);
  if (!result.passed || !result.cleanTree) process.exitCode = 1;
}
