import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_REVISION } from '../../contract/index.js';
import { boardsmithPackageRoot, readBoardsmithVersion } from './boardsmith-version.js';
import { gitOutput as git } from './git-output.js';

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
 * ADDING A CHECK (the in-browser smoke test, #453, is the next one): add its name to
 * `VERIFY_CHECK_NAMES` and its runner to `VERIFY_CHECKS` in `commands/verify.ts`, which the compiler
 * then requires. Every check result has the same shape (`VerifyCheckResult`), with optional counts
 * and file-and-line findings, so nothing here changes. A result written before the check existed
 * lacks it, and `resultProblem` refuses it, so the new check cannot be skipped by an old result.
 */

/** The version of the file's shape. A result in any other format is made again. */
const VERIFY_RESULT_FORMAT = 1;

/** Every check `boardsmith verify` runs, in the order it runs them. A passing result has all of them. */
export const VERIFY_CHECK_NAMES = ['test', 'typecheck', 'build', 'validate', 'mutation'] as const;

export type VerifyCheckName = (typeof VERIFY_CHECK_NAMES)[number];

/** A place in the project a check points at: for the mutation check, a mutant no test caught. */
interface VerifyFinding {
  file: string;
  line: number;
  detail: string;
}

/** One check's outcome. `summary` says what happened; `next`, on a failure, says what to run. */
export interface VerifyCheckResult {
  name: VerifyCheckName;
  passed: boolean;
  summary: string;
  next?: string;
  /** What the check counted: tests run, passed and failed; mutants tried, killed and survived. */
  counts?: Record<string, number>;
  findings?: VerifyFinding[];
}

export interface VerifyResult {
  format: typeof VERIFY_RESULT_FORMAT;
  /** The commit the checks ran on. */
  commit: string;
  /** Whether the working tree had no uncommitted or untracked changes, before and after the run. */
  cleanTree: boolean;
  /** Where the mutation check's diff started: the ref asked for, and the merge base it resolved to. */
  base: { ref: string; commit: string };
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
  checks: VerifyCheckResult[];
  boardsmithCommit?: string | null;
}): VerifyResult {
  return {
    format: VERIFY_RESULT_FORMAT,
    commit: input.commit,
    cleanTree: input.cleanTree,
    base: input.base,
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

/** Where the result for `commit` lives in a project. */
export function verifyResultPath(projectDir: string, commit: string): string {
  return join(projectDir, '.boardsmith', 'verify', `${commit}.json`);
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
  const missing = VERIFY_CHECK_NAMES.filter((name) => !result.checks.some((c) => c.name === name));
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
  return undefined;
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
 * Why HEAD in `projectDir` is not verified, or undefined when it is: the tree is clean and a
 * passing `boardsmith verify` result for HEAD, made on a clean tree, is on file.
 */
export async function verifiedProblem(projectDir: string): Promise<string | undefined> {
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
  return resultProblem(result, state.commit);
}
