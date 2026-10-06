/**
 * `boardsmith review-gate <slug> [--work-role <role>] [--since <commit>] [--project <dir>]` (#454).
 *
 * Model reviewers used to spend most of their tokens re-running checks that need no model: the
 * suite, typecheck, build, validate, and breaking code to see whether a test notices. So no model
 * review of a chunk's work starts until `boardsmith verify --chunk <slug>` has passed for the
 * commit under review, and the reviewer is told what verify found, from the result on file.
 *
 * The command is that gate. Every review step in the bs- skills (red team, the audit lenses,
 * fidelity, final acceptance, the cross-chunk lens) runs it before dispatching a reviewer:
 *
 *   - It refuses, exit 1, unless HEAD, on a clean tree, has a passing verify result that measured
 *     the chunk's whole change (`verifiedProblem`, the question `verify --check --chunk` asks). The
 *     refusal says to run `boardsmith verify`.
 *   - Open, it prints the review level and then the brief every review prompt carries verbatim:
 *     that the mechanical checks are done, each check's outcome, where the result file is, the
 *     change under review, and not to run the checks again.
 *
 * THE SIZE RULE (`reviewLevel`). Only a small change made by the mechanical role may skip review or
 * have a light one; everything else is reviewed in full. A mechanical change is measured from the
 * commit before it began (`--since`), in lines added plus lines removed; a changed binary file
 * counts as too large to lighten.
 *
 * `--since` also scopes a re-review: after a repair, only the change since the commit the last
 * round reviewed goes back to the reviewer.
 */
import { relative, resolve } from 'node:path';
import chalk from 'chalk';
import { ESCALATION_LADDER, type WorkRole } from '../lib/agent-roles.js';
import { gitOutput as git, gitSucceeds } from '../lib/git-output.js';
import { assertBareName } from '../lib/user-name.js';
import {
  type VerifyResult,
  checkoutState,
  readVerifyResult,
  verifiedProblem,
  verifyResultPath,
} from '../lib/verify-result.js';

/** A mechanical change of at most this many lines changed needs no model review. */
export const SMALL_CHANGE_LINES = 20;

/** A mechanical change of at most this many lines changed gets a light review; beyond it, a full one. */
export const LIGHT_REVIEW_LINES = 200;

type ReviewLevel = 'none' | 'light' | 'full';

/** How much review a change needs, from the role that made it and its size in changed lines. */
export function reviewLevel(workRole: WorkRole, changedLines: number): { level: ReviewLevel; reason: string } {
  if (workRole !== 'mechanical') {
    return { level: 'full', reason: `work by the ${workRole} role is always reviewed in full` };
  }
  const size = Number.isFinite(changedLines) ? `${changedLines} changed lines` : 'a changed binary file';
  if (changedLines <= SMALL_CHANGE_LINES) {
    return { level: 'none', reason: `a mechanical change of ${size}, at most ${SMALL_CHANGE_LINES}` };
  }
  if (changedLines <= LIGHT_REVIEW_LINES) {
    return { level: 'light', reason: `a mechanical change of ${size}, at most ${LIGHT_REVIEW_LINES}` };
  }
  return { level: 'full', reason: `a mechanical change of ${size}, more than ${LIGHT_REVIEW_LINES}` };
}

const short = (commit: string) => commit.slice(0, 12);

/** Lines added plus removed between two commits; Infinity when a binary file changed. */
async function changedLinesBetween(projectDir: string, from: string, to: string): Promise<number> {
  const numstat = await git(projectDir, ['diff', '--numstat', from, to]);
  let total = 0;
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [added, removed] = line.split('\t');
    if (added === '-' || removed === '-') return Infinity;
    total += Number(added) + Number(removed);
  }
  return total;
}

/** The commit `since` names, checked to be `head` or a commit before it. */
async function sinceCommit(projectDir: string, since: string, head: string): Promise<string> {
  const refusal = new Error(
    `--since ${since} is not a commit before the one under review (${short(head)}). ` +
      'Pass the commit the change under review started from: for a re-review, the commit the last round reviewed.',
  );
  let commit: string;
  try {
    commit = (await git(projectDir, ['rev-parse', '--verify', '--quiet', `${since}^{commit}`])).trim();
  } catch {
    throw refusal;
  }
  const isBefore = await gitSucceeds(projectDir, ['merge-base', '--is-ancestor', commit, head]);
  if (!isBefore) throw refusal;
  return commit;
}

function parseWorkRole(value: string | undefined): WorkRole | undefined {
  if (value === undefined) return undefined;
  if (!(ESCALATION_LADDER as readonly string[]).includes(value)) {
    throw new Error(
      `--work-role names the role that did the work under review: mechanical, bounded or judgement. Got "${value}".`,
    );
  }
  return value as WorkRole;
}

/** The text every review prompt carries: the mechanical checks are done, and what they found. */
function reviewBrief(projectDir: string, slug: string, result: VerifyResult, from: string): string {
  return [
    `Mechanical checks: done. \`boardsmith verify --chunk ${slug}\` passed for commit ${short(result.commit)} on a clean tree ` +
      `(result: ${relative(projectDir, verifyResultPath(projectDir, result.commit))}, changes measured since ${result.base.ref} ` +
      `at ${short(result.base.commit)}):`,
    ...result.checks.map((check) => `- ${check.name}: ${check.summary}`),
    `The change under review: \`git diff ${short(from)}..${short(result.commit)}\`.`,
    'Do not run the suite, typecheck, build, validate, the smoke test or a mutation check again, and do not break code ' +
      'to see whether a test notices: verify did all of that for this commit. Your review is the judgement checks ' +
      'listed in this prompt, and nothing a script can check.',
  ].join('\n');
}

type ReviewGate =
  | { open: false; refusal: string }
  | { open: true; level: ReviewLevel; reason: string; changedLines: number; brief: string };

/**
 * Whether a model review of chunk `slug`'s work may start, and if so how much review it needs and
 * the brief its prompts carry. Throws on arguments it cannot use.
 */
export async function reviewGate(options: {
  projectDir: string;
  slug: string;
  workRole?: string;
  since?: string;
}): Promise<ReviewGate> {
  assertBareName('<slug>', options.slug, "Pass the chunk's slug, as SKETCH.md's Ordered Chunk List names it.");
  const workRole = parseWorkRole(options.workRole);
  if (workRole === 'mechanical' && options.since === undefined) {
    throw new Error(
      'A mechanical change is sized from the commit before it began: pass --since <that commit>, so the size rule measures ' +
        'that change and not the whole chunk.',
    );
  }
  const problem = await verifiedProblem(options.projectDir, options.slug);
  if (problem !== undefined) {
    return {
      open: false,
      refusal: [
        `No model review may start for chunk "${options.slug}": the commit under review has no passing \`boardsmith verify\` result that covers the chunk.`,
        problem,
        `Run \`npx boardsmith verify --chunk ${options.slug}\`, fix what it names and commit until it passes, then run ` +
          `\`boardsmith review-gate ${options.slug}\` again. A failing verify goes back to the step that made the change, ` +
          'with no review round: retried once at the same role, then one role up.',
      ].join('\n'),
    };
  }
  const state = await checkoutState(options.projectDir);
  const result = 'commit' in state ? await readVerifyResult(options.projectDir, state.commit) : undefined;
  if (result === undefined || result === 'unreadable') {
    throw new Error('The verify result for the current commit could not be read. Run `boardsmith verify` again.');
  }
  const from = options.since === undefined ? result.base.commit : await sinceCommit(options.projectDir, options.since, result.commit);
  const changedLines = await changedLinesBetween(options.projectDir, from, result.commit);
  const { level, reason } = reviewLevel(workRole ?? 'judgement', changedLines);
  return { open: true, level, reason, changedLines, brief: reviewBrief(options.projectDir, options.slug, result, from) };
}

export async function reviewGateCommand(
  slug: string,
  options: { project?: string; workRole?: string; since?: string },
): Promise<void> {
  const gate = await reviewGate({
    projectDir: resolve(options.project ?? process.cwd()),
    slug,
    workRole: options.workRole,
    since: options.since,
  });
  if (!gate.open) {
    console.error(chalk.red(gate.refusal));
    process.exitCode = 1;
    return;
  }
  console.log(`Review level: ${gate.level} (${gate.reason})`);
  if (gate.level === 'none') {
    console.log('No model review runs for this change: verify is its whole gate. Record no review round, and continue.');
    return;
  }
  console.log('');
  console.log(gate.brief);
}
