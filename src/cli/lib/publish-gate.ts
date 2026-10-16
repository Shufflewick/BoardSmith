import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { gitOutput as git, gitSucceeds } from './git-output.js';
import { checkoutState, readVerifyResult, verifiedProblem, type VerifyResult } from './verify-result.js';

/**
 * `boardsmith publish` refuses unless a full `boardsmith verify` passed for the commit being
 * published, on a clean tree, measured from the last published commit (#984), or from where HEAD's
 * history left it when that history was rewritten.
 *
 * The last publish is recorded in `.boardsmith/published.json`, local and ignored by git like the
 * verify results it relies on. A machine without the record measures from the repository's first
 * commit, and one with an older record from that older commit, so a missing or stale record only
 * asks for more coverage, never less: every recorded commit had itself passed this gate.
 */

interface Published {
  commit: string;
  /** The base the published commit's result was measured from: republishing it asks for the same. */
  base: string;
}

const short = (commit: string) => commit.slice(0, 12);

const publishedPath = (projectDir: string) => join(projectDir, '.boardsmith', 'published.json');

export async function recordPublished(projectDir: string, published: Published): Promise<void> {
  await fs.mkdir(join(projectDir, '.boardsmith'), { recursive: true });
  await fs.writeFile(publishedPath(projectDir), `${JSON.stringify(published, null, 2)}\n`);
}

/** The commit a publish of `head` must be measured from, and what that commit is, or why there is none. */
async function requiredBase(projectDir: string, head: string): Promise<{ commit: string; what: string } | { problem: string }> {
  let text: string | undefined;
  try {
    text = await fs.readFile(publishedPath(projectDir), 'utf-8');
  } catch {
    // No publish recorded on this machine.
  }
  if (text === undefined) {
    const first = (await git(projectDir, ['rev-list', '--max-parents=0', 'HEAD'])).trim().split('\n').pop()!;
    if (first === head) {
      return {
        problem:
          `The commit being published (${short(head)}) is this repository's only commit, so \`boardsmith verify\` has no ` +
          'change to measure from the first commit. Commit your game on top of it, then run `boardsmith verify --base ' +
          `${first}\`.`,
      };
    }
    return { commit: first, what: "the repository's first commit" };
  }
  const unusable = {
    problem:
      '.boardsmith/published.json does not name a commit in this repository, so there is no base to measure this ' +
      "publish from. Delete it to measure from the repository's first commit, then run `boardsmith publish` again.",
  };
  let published: Published;
  try {
    published = JSON.parse(text) as Published;
  } catch {
    return unusable;
  }
  if (published.commit === head) return { commit: published.base, what: 'the base this commit was published with' };
  try {
    const commit = (await git(projectDir, ['merge-base', `${published.commit}^{commit}`, 'HEAD'])).trim();
    return { commit, what: 'the last published commit' };
  } catch {
    return unusable;
  }
}

/** Why `result`, which `verifiedProblem` accepts, does not cover a publish measured from `base`. */
async function coverageProblem(projectDir: string, result: VerifyResult, base: { commit: string; what: string }): Promise<string | undefined> {
  const of = `The \`boardsmith verify\` result for ${short(result.commit)}`;
  const skipped = result.checks.filter((check) => check.skipped);
  if (skipped.length > 0) {
    return `${of} skipped its ${skipped.map((c) => c.name).join(', ')} check: ${skipped.map((c) => c.summary).join(' ')}`;
  }
  if (result.base.commit === result.commit) return `${of} measured no change: its base is the commit itself.`;
  if (await gitSucceeds(projectDir, ['merge-base', '--is-ancestor', result.base.commit, base.commit])) return undefined;
  return (
    `${of} measured the change from ${result.base.ref} (${short(result.base.commit)}), ` +
    `which does not cover everything since ${base.what} (${short(base.commit)}).`
  );
}

/** The verify result that vouches for publishing `head`, or why there is none. */
async function publishableResult(
  projectDir: string,
  state: { commit: string; clean: boolean },
  base: { commit: string; what: string },
): Promise<VerifyResult | string> {
  const of = `The \`boardsmith verify\` result for ${short(state.commit)}`;
  if (!state.clean) {
    return (
      'The working tree has uncommitted or untracked changes, so it is not the commit that would be published. ' +
      'Commit your work first. (`git status` lists the changes.)'
    );
  }
  const result = await readVerifyResult(projectDir, state.commit);
  if (result === undefined) return `No passing \`boardsmith verify\` result for commit ${short(state.commit)}. Commit your work first.`;
  if (result === 'unreadable') return `${of} could not be read.`;
  if (result.scope !== undefined) return `${of} is a focused one: it ran only the authored tests and typecheck.`;
  return (await verifiedProblem(projectDir)) ?? (await coverageProblem(projectDir, result, base)) ?? result;
}

/**
 * The commit to publish and the base its verify result measured, or why it may not be published.
 * Reads only git and local files, so it runs before any key lookup or network call.
 */
export async function publishGate(projectDir: string): Promise<{ problem: string } | Published> {
  const state = await checkoutState(projectDir);
  if ('problem' in state) return state;
  const base = await requiredBase(projectDir, state.commit);
  if ('problem' in base) return base;
  const result = await publishableResult(projectDir, state, base);
  if (typeof result !== 'string') return { commit: state.commit, base: result.base.commit };
  return {
    problem:
      `${result}\nPublishing needs a full, passing \`boardsmith verify\` for this commit on a clean tree: ` +
      `run \`boardsmith verify --base ${base.commit}\`, which measures the change since ${base.what}.`,
  };
}
