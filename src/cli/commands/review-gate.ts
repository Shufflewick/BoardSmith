/**
 * `boardsmith review-gate <slug> [--project <dir>]` (#454).
 *
 * Model reviewers used to spend most of their tokens re-running checks that need no model: the
 * suite, typecheck, build, validate, and breaking code to see whether a test notices. So no model
 * review of a chunk's work starts until `boardsmith verify --chunk <slug>` (the chunk's tests and
 * typecheck, #985) has passed for the commit under review, and the reviewer is told what it found,
 * from the result on file, and that the full checks run at publish, by no reviewer.
 *
 * The command is that gate. Every review step in the bs- skills (red team, the audit lenses,
 * fidelity, final acceptance, the cross-chunk lens) runs it before dispatching a reviewer:
 *
 *   - It refuses, exit 1, unless HEAD, on a clean tree, has the chunk's passing fast checks
 *     (`verifiedProblem`, the question `verify --check --chunk` asks). The refusal says to run
 *     `boardsmith verify --chunk <slug>`.
 *   - Open, it prints the review level and then the brief every review prompt carries verbatim:
 *     that only the fast checks ran, each one's outcome, where the result file is, the change
 *     under review, that the full checks run at publish, and not to run any check.
 *
 * WHAT IS UNDER REVIEW comes from the chunk's run log, `design/run-log/<slug>.md`, never from the
 * caller (#829): the change since the commit the latest review round reviewed (the chunk's verify
 * base before any round), and the role of every dispatch logged since that round.
 *
 * THE SIZE RULE (`reviewLevel`). Only a small change made by the mechanical role may skip review or
 * have a light one; everything else is reviewed in full. A change is mechanical only when every
 * dispatch since the last round was, and is measured in lines added plus lines removed, leaving the
 * run logs out (#1000); a changed binary file counts as too large to lighten.
 */
import { promises as fs } from 'node:fs';
import { relative, resolve } from 'node:path';
import { styleText } from 'node:util';
import { gitOutput as git, gitSucceeds } from '../lib/git-output.js';
import { RUN_LOG_DIR, designPath } from '../lib/project-paths.js';
import { reviewScope } from '../lib/run-log-roles.js';
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

/** How much review a change needs, from the roles of the dispatches that made it and its size in changed lines. */
export function reviewLevel(roles: string[], changedLines: number): { level: ReviewLevel; reason: string } {
  if (roles.length === 0) {
    return { level: 'full', reason: 'the run log records no dispatch since the last review round, so who did the work is unknown' };
  }
  const others = [...new Set(roles.filter((role) => role !== 'mechanical'))];
  if (others.length) {
    return { level: 'full', reason: `work by the ${others.join(' and ')} role${others.length > 1 ? 's' : ''} is always reviewed in full` };
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

/** Lines added plus removed between two commits, outside the run logs; Infinity when a binary file changed. */
async function changedLinesBetween(projectDir: string, from: string, to: string): Promise<number> {
  // The run logs are the workflow's own bookkeeping between rounds, not the change under review (#1000).
  const runLogs = relative(projectDir, designPath(projectDir, RUN_LOG_DIR));
  const numstat = await git(projectDir, ['diff', '--numstat', from, to, '--', `:(exclude)${runLogs}`]);
  let total = 0;
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [added, removed] = line.split('\t');
    if (added === '-' || removed === '-') return Infinity;
    total += Number(added) + Number(removed);
  }
  return total;
}

/** The commit a run log's review round reviewed, checked to be `head` or a commit before it. */
async function sinceCommit(projectDir: string, slug: string, since: { round: string; commit: string }, head: string): Promise<string> {
  const refusal = new Error(
    `design/${RUN_LOG_DIR}/${slug}.md: ${since.round} says it reviewed ${since.commit}, which is not a commit before the one ` +
      `under review (${short(head)}). Fix its "- Verify:" line to the commit review-gate named for that round.`,
  );
  let commit: string;
  try {
    commit = (await git(projectDir, ['rev-parse', '--verify', '--quiet', `${since.commit}^{commit}`])).trim();
  } catch {
    throw refusal;
  }
  const isBefore = await gitSucceeds(projectDir, ['merge-base', '--is-ancestor', commit, head]);
  if (!isBefore) throw refusal;
  return commit;
}

/** The chunk's run log, or empty when it has none yet. */
async function readRunLog(projectDir: string, slug: string): Promise<string> {
  try {
    return await fs.readFile(designPath(projectDir, `${RUN_LOG_DIR}/${slug}.md`), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

/** The text every review prompt carries: which checks ran, what they found, and which run at publish (#985). */
function reviewBrief(projectDir: string, slug: string, result: VerifyResult, from: string): string {
  return [
    `Fast checks: done. \`boardsmith verify --chunk ${slug}\` passed for commit ${short(result.commit)} on a clean tree ` +
      `(result: ${relative(projectDir, verifyResultPath(projectDir, result.commit))}, changes measured since ${result.base.ref} ` +
      `at ${short(result.base.commit)}):`,
    ...result.checks.map((check) => `- ${check.name}: ${check.summary}`),
    `The change under review: \`git diff ${short(from)}..${short(result.commit)}\`.`,
    "Only the fast checks have run: the chunk's tests and typecheck. The full suite, build, validate, the smoke test " +
      'and the mutation check run at publish, not per chunk. Do not run any of them, or the fast checks again, and do ' +
      'not break code to see whether a test notices. Your review is the judgement checks listed in this prompt, and ' +
      'nothing a script can check.',
  ].join('\n');
}

type ReviewGate =
  | { open: false; refusal: string }
  | { open: true; level: ReviewLevel; reason: string; changedLines: number; brief: string };

/**
 * Whether a model review of chunk `slug`'s work may start, and if so how much review it needs and
 * the brief its prompts carry. Throws on arguments it cannot use.
 */
export async function reviewGate(options: { projectDir: string; slug: string }): Promise<ReviewGate> {
  assertBareName('<slug>', options.slug, "Pass the chunk's slug, as SKETCH.md's Ordered Chunk List names it.");
  const problem = await verifiedProblem(options.projectDir, options.slug);
  if (problem !== undefined) {
    return {
      open: false,
      refusal: [
        `No model review may start for chunk "${options.slug}": the commit under review has no passing \`boardsmith verify --chunk ${options.slug}\` result.`,
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
  const scope = reviewScope(await readRunLog(options.projectDir, options.slug), `design/${RUN_LOG_DIR}/${options.slug}.md`);
  const from = scope.since === undefined ? result.base.commit : await sinceCommit(options.projectDir, options.slug, scope.since, result.commit);
  const changedLines = await changedLinesBetween(options.projectDir, from, result.commit);
  const { level, reason } = reviewLevel(scope.roles, changedLines);
  return { open: true, level, reason, changedLines, brief: reviewBrief(options.projectDir, options.slug, result, from) };
}

export async function reviewGateCommand(slug: string, options: { project?: string }): Promise<void> {
  const gate = await reviewGate({ projectDir: resolve(options.project ?? process.cwd()), slug });
  if (!gate.open) {
    console.error(styleText('red', gate.refusal));
    process.exitCode = 1;
    return;
  }
  console.log(`Review level: ${gate.level} (${gate.reason})`);
  if (gate.level === 'none') {
    console.log('No model review runs for this change: its fast checks are its whole gate. Record no review round, and continue.');
    return;
  }
  console.log('');
  console.log(gate.brief);
}
