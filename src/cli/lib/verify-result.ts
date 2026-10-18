import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_REVISION } from '../../contract/index.js';
import { boardsmithPackageRoot, readBoardsmithVersion } from './boardsmith-version.js';
import { gitOutput as git } from './git-output.js';
import { openMutantCache } from './mutant-cache.js';
import { equivalenceBasisProblem, type EquivalenceBasis } from './mutation-equivalences.js';
import { readIfExists } from './read-if-exists.js';

/**
 * The result `boardsmith verify` writes, and the one question every done claim asks of it (#452).
 *
 * A result is tied to ONE commit and to whether the working tree was clean when it was made. It
 * lives at `.boardsmith/verify/<commit>.json` in the project, which a game's `.gitignore` keeps out
 * of git, so writing it never dirties the tree it describes.
 *
 * `verifiedProblem` is what `boardsmith verify --check`, `chunk-signoff`, `review-gate` and
 * `chunk-gate-transition` ask: does HEAD, on a clean tree, have a passing result? A result for
 * another commit, a result made on a dirty tree, and a dirty tree now all say no, each with what to
 * run next.
 *
 * A chunk's gates (`chunk-signoff <slug>`, `review-gate <slug>`, `verify --check --chunk <slug>`)
 * take only that chunk's fast checks: a result `verify --chunk <slug>` made, holding the chunk's
 * tests and typecheck. Every other question (`verify --check`, `chunk-gate-transition`, publish)
 * takes only the full verify, so a chunk's fast checks never stand in for it (#985).
 *
 * ADDING A CHECK (the in-browser smoke test, #453, was added this way): add its name to
 * `VERIFY_CHECK_NAMES` and its runner to `VERIFY_CHECKS` in `commands/verify.ts`, which the compiler
 * then requires. Every check result has the same shape (`VerifyCheckResult`), with optional counts
 * and file-and-line findings, so nothing here changes. A result written before the check existed
 * lacks it, and `resultProblem` refuses it, so the new check cannot be skipped by an old result.
 */

/** The version of the file's shape. A result in any other format is made again. */
export const VERIFY_RESULT_FORMAT = 1;

/** Every full check, in execution order. A chunk's result holds `CHUNK_VERIFY_CHECK_NAMES`. */
export const VERIFY_CHECK_NAMES = ['test', 'typecheck', 'build', 'validate', 'smoke', 'mutation'] as const;
/** `verify --chunk`: the chunk's own tests and typecheck. The full checks run at publish (#985). */
export const CHUNK_VERIFY_CHECK_NAMES = ['test', 'typecheck'] as const;

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
  /** Where the verified change started: the full verify's base, or the chunk's verify base. */
  base: { ref: string; commit: string };
  /** The chunk `--chunk` named, whose verify base is `base`; null when the run was not for a chunk. */
  chunk: string | null;
  /** The BoardSmith that ran the checks. `commit` is null for an installed copy, which has no git. */
  boardsmith: { version: string; engineRevision: number; commit: string | null };
  finishedAt: string;
  passed: boolean;
  checks: VerifyCheckResult[];
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
  const text = await readIfExists(verifyResultPath(projectDir, commit), (p) => fs.readFile(p, 'utf-8'));
  if (text === undefined) return undefined;
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
  const required = result.chunk !== null ? CHUNK_VERIFY_CHECK_NAMES : VERIFY_CHECK_NAMES;
  const missing = required.filter((name) => !result.checks.some((c) => c.name === name));
  if (missing.length > 0) {
    return (
      `The \`boardsmith verify\` result for ${short(head)} has no ${missing.join(', ')} check: it was made before ` +
      `this BoardSmith required ${missing.length === 1 ? 'it' : 'them'}. Run \`boardsmith verify\` again.`
    );
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

/**
 * Why `result` is the wrong kind for the question: a chunk's gates take only that chunk's fast
 * checks (`verify --chunk <slug>`), and every other question the full verify (#985).
 */
function kindProblem(result: VerifyResult, chunk: string | undefined): string | undefined {
  if (chunk === undefined && result.chunk !== null) {
    return (
      `The \`boardsmith verify\` result for ${short(result.commit)} is chunk "${result.chunk}"'s fast checks (its tests and ` +
      'typecheck), not the full verify. Run `boardsmith verify`.'
    );
  }
  if (chunk !== undefined && result.chunk !== chunk) {
    return `The \`boardsmith verify\` result for ${short(result.commit)} was not made for chunk "${chunk}". Run \`boardsmith verify --chunk ${chunk}\`.`;
  }
  return undefined;
}

/** Why the result on file does not vouch for HEAD: `resultProblem`, then a full run's equivalence review, rechecked now. */
async function currentResultProblem(projectDir: string, result: VerifyResult, commit: string): Promise<string | undefined> {
  const problem = resultProblem(result, commit);
  if (problem !== undefined) return problem;
  const basis = result.checks.find((c) => c.name === 'mutation')?.equivalence;
  if (basis !== undefined) return equivalenceBasisProblem(projectDir, basis, await openMutantCache(projectDir));
  return undefined;
}

/**
 * Why HEAD in `projectDir` is not verified, or undefined when it is: the tree is clean and a
 * passing `boardsmith verify` result for HEAD, made on a clean tree, is on file. With `chunk`, it
 * must be that chunk's fast checks; without, the full verify (`kindProblem`).
 */
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
  return kindProblem(result, chunk) ?? (await currentResultProblem(projectDir, result, state.commit));
}
