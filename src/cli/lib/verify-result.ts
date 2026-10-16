import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_REVISION } from '../../contract/index.js';
import { boardsmithPackageRoot, readBoardsmithVersion } from './boardsmith-version.js';
import { chunkVerifyBase } from './chunk-commits.js';
import { gitOutput as git, gitSucceeds } from './git-output.js';
import { openMutantCache } from './mutant-cache.js';
import { equivalenceBasisProblem, type EquivalenceBasis } from './mutation-equivalences.js';
import { focusedVerificationScope, type FocusedVerificationScope } from './authored-tests.js';

/**
 * The result `boardsmith verify` writes, and the one question every done claim asks of it (#452).
 *
 * A result is tied to ONE commit and to whether the working tree was clean when it was made. It
 * lives at `.boardsmith/verify/<commit>.json` in the project, which a game's `.gitignore` keeps out
 * of git, so writing it never dirties the tree it describes.
 *
 * `verifiedProblem` is what `boardsmith verify --check`, `chunk-signoff` and
 * `chunk-gate-transition` ask: does HEAD, on a clean tree, have a passing result? A result for
 * another commit, a result made on a dirty tree, and a dirty tree now all say no, each with what to
 * run next.
 *
 * For a chunk (`chunk-signoff <slug>`, `verify --check --chunk <slug>`) it asks one thing more: did
 * the result measure the chunk's whole change? Its base must be the chunk's verify base, the
 * commit before the chunk's first `chunk-<slug>/` commit, or a commit before that. Without this,
 * `boardsmith verify --base HEAD` (which mutates nothing, and passes) would let anyone sign a chunk
 * off. `chunk-gate-transition` builds no chunk, so it asks only the plain question, and the
 * `--base HEAD` result it accepts satisfies no chunk's sign-off.
 *
 * ADDING A CHECK (the in-browser smoke test, #453, was added this way): add its name to
 * `VERIFY_CHECK_NAMES` and its runner to `VERIFY_CHECKS` in `commands/verify.ts`, which the compiler
 * then requires. Every check result has the same shape (`VerifyCheckResult`), with optional counts
 * and file-and-line findings, so nothing here changes. A result written before the check existed
 * lacks it, and `resultProblem` refuses it, so the new check cannot be skipped by an old result.
 */

/** The version of the file's shape. A result in any other format is made again. */
export const VERIFY_RESULT_FORMAT = 1;

/** Every default full check, in execution order. Focused results use `FOCUSED_VERIFY_CHECK_NAMES`. */
export const VERIFY_CHECK_NAMES = ['test', 'typecheck', 'build', 'validate', 'smoke', 'mutation'] as const;
export const FOCUSED_VERIFY_CHECK_NAMES = ['test', 'typecheck'] as const;

export type VerifyCheckName = (typeof VERIFY_CHECK_NAMES)[number];

/** A place in the project a check points at: for the mutation check, a mutant no test caught. */
interface VerifyFinding {
  file: string;
  line: number;
  detail: string;
  mutantId?: string;
}

/**
 * One check's outcome, without its name. `summary` says what happened; `next`, on a failure, says
 * what to run. A check either ran, passing or failing, or was skipped, which never fails.
 */
export type VerifyCheckOutcome = {
  summary: string;
  next?: string;
  /** What the check counted: tests run, passed and failed; mutants tried, killed and survived. */
  counts?: Record<string, number>;
  findings?: VerifyFinding[];
  /** Trusted reviewed survivors used by the mutation check, revalidated for every done claim. */
  equivalence?: EquivalenceBasis;
} & (
  | { passed: boolean; skipped?: never }
  /**
   * The check did not run, and `summary` says why: `build` and `smoke` in a project with no UI yet.
   * Every report of the result names it.
   */
  | { passed: true; skipped: true }
);

/** One check's outcome, with the check's name. */
export type VerifyCheckResult = VerifyCheckOutcome & { name: VerifyCheckName };

export interface VerifyResult {
  format: typeof VERIFY_RESULT_FORMAT;
  /** The commit the checks ran on. */
  commit: string;
  /** Whether the working tree had no uncommitted or untracked changes, before and after the run. */
  cleanTree: boolean;
  /** Where the verified change started: the full diff base or the focused ticket's declared base. */
  base: { ref: string; commit: string };
  /** The chunk `--chunk` named, whose verify base is `base`; null when the run was not for a chunk. */
  chunk: string | null;
  /** The BoardSmith that ran the checks. `commit` is null for an installed copy, which has no git. */
  boardsmith: { version: string; engineRevision: number; commit: string | null };
  finishedAt: string;
  passed: boolean;
  checks: VerifyCheckResult[];
  /** Absent for the default full run; focused results claim only their authored tests and typecheck. */
  scope?: FocusedVerificationScope;
}

/** The commit of the BoardSmith checkout this CLI runs from, or null when it is an installed copy. */
async function boardsmithCommit(): Promise<string | null> {
  const root = boardsmithPackageRoot();
  try {
    const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
    const [realTop, realRoot] = await Promise.all([fs.realpath(top), fs.realpath(root)]);
    if (realTop !== realRoot) return null;
    return (await git(root, ['rev-parse', 'HEAD'])).trim();
  } catch {
    return null;
  }
}

let cachedBoardsmithCommit: Promise<string | null> | undefined;

/** A result for `commit` from its checks: it passes only when every check passed. */
export function buildVerifyResult(input: {
  commit: string;
  cleanTree: boolean;
  base: { ref: string; commit: string };
  chunk?: string | null;
  checks: VerifyCheckResult[];
  boardsmithCommit?: string | null;
  scope?: FocusedVerificationScope;
}): VerifyResult {
  return {
    format: VERIFY_RESULT_FORMAT,
    commit: input.commit,
    cleanTree: input.cleanTree,
    base: input.base,
    chunk: input.chunk ?? null,
    boardsmith: {
      version: readBoardsmithVersion(),
      engineRevision: ENGINE_REVISION,
      commit: input.boardsmithCommit ?? null,
    },
    finishedAt: new Date().toISOString(),
    passed: input.checks.every((c) => c.passed),
    checks: input.checks,
    ...(input.scope === undefined ? {} : { scope: input.scope }),
  };
}

/** The BoardSmith commit to stamp into a result, read once per process. */
export function currentBoardsmithCommit(): Promise<string | null> {
  cachedBoardsmithCommit ??= boardsmithCommit();
  return cachedBoardsmithCommit;
}

/** The folder a project's verify results live in, one `<commit>.json` per commit verified. */
export function verifyResultsDir(projectDir: string): string {
  return join(projectDir, '.boardsmith', 'verify');
}

/** Where the result for `commit` lives in a project. */
export function verifyResultPath(projectDir: string, commit: string): string {
  return join(verifyResultsDir(projectDir), `${commit}.json`);
}

export async function writeVerifyResult(projectDir: string, result: VerifyResult): Promise<string> {
  const path = verifyResultPath(projectDir, result.commit);
  await fs.mkdir(join(path, '..'), { recursive: true });
  const partial = `${path}.${process.pid}.tmp`;
  await fs.writeFile(partial, `${JSON.stringify(result, null, 2)}\n`);
  await fs.rename(partial, path);
  return path;
}

/** The result for `commit`, undefined when there is none, or 'unreadable' when the file is not JSON. */
export async function readVerifyResult(projectDir: string, commit: string): Promise<VerifyResult | 'unreadable' | undefined> {
  let text: string;
  try {
    text = await fs.readFile(verifyResultPath(projectDir, commit), 'utf-8');
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text) as VerifyResult;
  } catch {
    return 'unreadable';
  }
}

const short = (commit: string) => commit.slice(0, 12);

const RUN_AGAIN = 'Commit your work, then run `boardsmith verify`.';

function missingEquivalenceBasis(result: VerifyResult): string | undefined {
  const mutation = result.checks.find((c) => c.name === 'mutation');
  if ((mutation?.counts?.equivalent ?? 0) > 0 && !mutation?.equivalence) {
    return `The equivalent-mutant review basis is missing from this result. Run \`boardsmith verify\` again.`;
  }
  return undefined;
}

/** Why `result` does not vouch for `head`, or undefined when it does. */
export function resultProblem(result: VerifyResult, head: string): string | undefined {
  if (result.format !== VERIFY_RESULT_FORMAT || !Array.isArray(result.checks)) {
    return `The \`boardsmith verify\` result for ${short(head)} was written by a different version of BoardSmith. Run \`boardsmith verify\` again.`;
  }
  if (result.commit !== head) {
    return `The \`boardsmith verify\` result on file is for a different commit (${short(result.commit)}), not the current one (${short(head)}). Run \`boardsmith verify\`.`;
  }
  if (!result.cleanTree) {
    return (
      `The \`boardsmith verify\` run for ${short(head)} ran while the working tree had uncommitted changes, ` +
      `so it does not show what this commit does. ${RUN_AGAIN}`
    );
  }
  if (result.scope !== undefined && (!result.scope || result.scope.kind !== 'focused' ||
    !result.scope.selection || typeof result.scope.selection.path !== 'string' ||
    !/^[a-f0-9]{64}$/.test(result.scope.selection.hash))) {
    return 'The focused verification scope is invalid. Run `boardsmith verify --selection <path>` again.';
  }
  const required = result.scope?.kind === 'focused' ? FOCUSED_VERIFY_CHECK_NAMES : VERIFY_CHECK_NAMES;
  const missing = required.filter((name) => !result.checks.some((c) => c.name === name));
  if (missing.length > 0) {
    return (
      `The \`boardsmith verify\` result for ${short(head)} has no ${missing.join(', ')} check: it was made before ` +
      `this BoardSmith required ${missing.length === 1 ? 'it' : 'them'}. Run \`boardsmith verify\` again.`
    );
  }
  if (result.scope?.kind === 'focused' && (result.checks.length !== required.length ||
    result.checks.some((check) => check.skipped || !(required as readonly string[]).includes(check.name)))) {
    return 'A focused result must contain only executed authored-test and typecheck checks. Run `boardsmith verify --selection <path>` again.';
  }
  if (result.scope?.kind === 'focused') {
    const tests = result.scope.selection.tests;
    const counts = result.checks.find((check) => check.name === 'test')?.counts;
    if (!Array.isArray(tests) || tests.length === 0 || tests.some((test) => !test || !Array.isArray(test.names) || test.names.length === 0) ||
      counts?.files !== tests.length || counts.tests !== tests.reduce((total, test) => total + test.names.length, 0) ||
      counts.passed !== counts.tests || (counts.failed ?? 0) !== 0 || (counts.skipped ?? 0) !== 0) {
      return 'The authored-test counts do not account for every declared test passing. Run `boardsmith verify --selection <path>` again.';
    }
  }
  const failed = result.checks.filter((c) => !c.passed);
  if (failed.length > 0 || !result.passed) {
    const lines = failed.map((c) => `  - ${c.name}: ${c.summary}${c.next ? ` ${c.next}` : ''}`);
    return [
      `\`boardsmith verify\` did not pass for ${short(head)}:`,
      ...lines,
      'Fix what it names, commit, and run `boardsmith verify` again.',
    ].join('\n');
  }
  return missingEquivalenceBasis(result);
}

/** The commit checked out in `projectDir` and whether its tree is clean, or why that cannot be said. */
export async function checkoutState(projectDir: string): Promise<{ commit: string; clean: boolean } | { problem: string }> {
  let commit: string;
  try {
    commit = (await git(projectDir, ['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  } catch {
    try {
      await git(projectDir, ['rev-parse', '--git-dir']);
    } catch {
      return {
        problem:
          `${projectDir} is not a git repository, so no \`boardsmith verify\` result can be tied to a commit. ` +
          'Run `git init`, commit your work, then run `boardsmith verify`.',
      };
    }
    return { problem: `${projectDir} has no commit yet. ${RUN_AGAIN}` };
  }
  const status = await git(projectDir, ['status', '--porcelain', '--untracked-files=all']);
  return { commit, clean: status.trim() === '' };
}

/** Whether `commit` is `descendant` or one of its ancestors. A commit git does not know is neither. */
function isAncestor(projectDir: string, commit: string, descendant: string): Promise<boolean> {
  return gitSucceeds(projectDir, ['merge-base', '--is-ancestor', commit, descendant]);
}

/**
 * Why `result` does not cover chunk `slug`'s change, or undefined when it does: its base is the
 * chunk's verify base or a commit before it. Throws, saying what to do, when the chunk has no
 * commit yet.
 */
async function chunkCoverageProblem(projectDir: string, slug: string, result: VerifyResult): Promise<string | undefined> {
  const chunkBase = await chunkVerifyBase(projectDir, slug);
  if (result.scope?.kind === 'focused' && result.chunk !== slug) {
    return `The focused result was not made for chunk "${slug}". Run \`boardsmith verify --chunk ${slug} --selection ${result.scope.selection.path}\`.`;
  }
  if (result.scope?.kind === 'focused') return undefined;
  if (await isAncestor(projectDir, result.base.commit, chunkBase)) return undefined;
  return (
    `The \`boardsmith verify\` result for ${short(result.commit)} measured the change from ${result.base.ref} ` +
    `(${short(result.base.commit)}), which is not where chunk "${slug}" started (${short(chunkBase)}) or a commit before it, ` +
    `so its mutation check did not cover the chunk's code. Run \`boardsmith verify --chunk ${slug}\`.`
  );
}

/**
 * Why HEAD in `projectDir` is not verified, or undefined when it is: the tree is clean and a
 * passing `boardsmith verify` result for HEAD, made on a clean tree, is on file. With `chunk`, the
 * result must also have measured that chunk's whole change (`chunkCoverageProblem`).
 */
async function currentResultProblem(projectDir: string, result: VerifyResult, commit: string): Promise<string | undefined> {
  const problem = resultProblem(result, commit);
  if (problem !== undefined) return problem;
  if (result.scope?.kind === 'focused') {
    try {
      const current = await focusedVerificationScope(projectDir, result.scope.selection.path);
      if (JSON.stringify(current) !== JSON.stringify(result.scope) || result.base.commit !== current.selection.base) {
        return 'The focused result does not match the committed authored-test selection. Run `boardsmith verify --selection <path>` again.';
      }
    } catch (error) { return (error as Error).message; }
  }
  const basis = result.checks.find((c) => c.name === 'mutation')?.equivalence;
  if (basis !== undefined) return equivalenceBasisProblem(projectDir, basis, await openMutantCache(projectDir));
  return undefined;
}

export async function verifiedProblem(projectDir: string, chunk?: string): Promise<string | undefined> {
  const state = await checkoutState(projectDir);
  if ('problem' in state) return state.problem;
  if (!state.clean) {
    return (
      'The working tree has uncommitted changes, so no `boardsmith verify` result can vouch for it. ' +
      `${RUN_AGAIN} (\`git status\` lists the changes.)`
    );
  }
  const result = await readVerifyResult(projectDir, state.commit);
  if (result === undefined) {
    return `No \`boardsmith verify\` result for the current commit (${short(state.commit)}). Run \`boardsmith verify\`.`;
  }
  if (result === 'unreadable') {
    return `The \`boardsmith verify\` result for ${short(state.commit)} could not be read. Run \`boardsmith verify\` again.`;
  }
  const problem = await currentResultProblem(projectDir, result, state.commit);
  if (problem !== undefined || chunk === undefined) return problem;
  try {
    return await chunkCoverageProblem(projectDir, chunk, result);
  } catch (error) {
    return (error as Error).message;
  }
}
