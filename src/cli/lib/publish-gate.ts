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

type Base = { commit: string; what: string };

const UNUSABLE = {
  problem:
    '.boardsmith/published.json does not name a commit in this repository, so there is no base to measure this ' +
    "publish from. Delete it to measure from the repository's first commit, then run `boardsmith publish` again.",
};

/** The last publish recorded on this machine, undefined when there is none, or 'unusable' when it is malformed. */
async function readPublished(projectDir: string): Promise<Published | 'unusable' | undefined> {
  let text: string;
  try {
    text = await fs.readFile(publishedPath(projectDir), 'utf-8');
  } catch {
    return undefined;
  }
  try {
    const published = JSON.parse(text) as Partial<Published> | null;
    if (typeof published?.commit === 'string' && typeof published.base === 'string') return { commit: published.commit, base: published.base };
  } catch {
    // Not JSON: as unusable as a record missing a field.
  }
  return 'unusable';
}

/**
 * Where the last publish leaves `head`'s unverified change starting: the published commit, or where
 * `head`'s history left it. When `head` is itself behind the published commit, that point is `head`
 * and measures nothing, so it is the base the published commit was measured from, which every earlier
 * publish covered up to, when `head` is past it; otherwise null.
 */
async function sinceLastPublish(projectDir: string, head: string, published: Published): Promise<Base | null | 'unusable'> {
  if (published.commit === head) return { commit: published.base, what: 'the base this commit was published with' };
  let fork: string;
  try {
    fork = (await git(projectDir, ['merge-base', `${published.commit}^{commit}`, 'HEAD'])).trim();
  } catch {
    return 'unusable';
  }
  if (fork !== head) return { commit: fork, what: 'the last published commit' };
  if (published.base !== head && await gitSucceeds(projectDir, ['merge-base', '--is-ancestor', published.base, head])) {
    return { commit: published.base, what: 'the base the last published commit was measured from' };
  }
  return null;
}

/** The commit a publish of `head` must be measured from, and what that commit is, or why there is none. */
async function requiredBase(projectDir: string, head: string): Promise<Base | { problem: string }> {
  const published = await readPublished(projectDir);
  if (published === 'unusable') return UNUSABLE;
  const since = published === undefined ? null : await sinceLastPublish(projectDir, head, published);
  if (since === 'unusable') return UNUSABLE;
  if (since !== null) return since;
  const first = (await git(projectDir, ['rev-list', '--max-parents=0', 'HEAD'])).trim().split('\n').pop()!;
  if (first !== head) return { commit: first, what: "the repository's first commit" };
  return {
    problem:
      `The commit being published (${short(head)}) is this repository's first commit, so \`boardsmith verify\` has no ` +
      'earlier commit to measure its change from. Commit your game on top of it, then run `boardsmith publish` again.',
  };
}

/** Why `result`, which `verifiedProblem` accepts, does not cover a publish measured from `base`. */
async function coverageProblem(projectDir: string, result: VerifyResult, base: Base): Promise<string | undefined> {
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

/** The verify result that vouches for publishing HEAD, or why there is none. */
async function publishableResult(projectDir: string, head: string, base: Base): Promise<VerifyResult | string> {
  const result = await readVerifyResult(projectDir, head);
  // Before verifiedProblem, which accepts a focused result and refuses one for focused reasons.
  if (typeof result === 'object' && result.scope !== undefined) {
    return `The \`boardsmith verify\` result for ${short(head)} is a focused one: it ran only the authored tests and typecheck.`;
  }
  const problem = await verifiedProblem(projectDir);
  if (problem !== undefined) return problem;
  // verifiedProblem refuses a missing or unreadable result, so this one is readable.
  return (await coverageProblem(projectDir, result as VerifyResult, base)) ?? (result as VerifyResult);
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
  const result = await publishableResult(projectDir, state.commit, base);
  if (typeof result !== 'string') return { commit: state.commit, base: result.base.commit };
  return {
    problem:
      `${result}\nPublishing needs a full, passing \`boardsmith verify\` for this commit on a clean tree: ` +
      `run \`boardsmith verify --base ${base.commit}\`, which measures the change since ${base.what}.`,
  };
}
