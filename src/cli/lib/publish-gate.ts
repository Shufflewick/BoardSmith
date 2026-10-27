import { join } from 'node:path';
import { checkoutState, readVerifyResult, verifiedProblem, type VerifyResult } from './verify-result.js';
import { bundleDigest, readDistDir } from './zip.js';

/**
 * `boardsmith publish` refuses unless a full `boardsmith verify` passed for the commit being
 * published, on a clean tree, with no check skipped (#984), and uploads the bundle that verify's
 * build check made (#1495): dist/ must still be exactly that bundle, so publish neither builds nor
 * validates again, and never uploads a build no verify checked.
 */

const short = (commit: string) => commit.slice(0, 12);

const VERIFY_AGAIN = 'Run `boardsmith verify` again; it rebuilds dist/.';

/** Why `result`, which `verifiedProblem` accepts, may not be published, or the bundle to upload. */
function publishable(projectDir: string, result: VerifyResult): string | Map<string, Uint8Array> {
  const of = `The \`boardsmith verify\` result for ${short(result.commit)}`;
  const skipped = result.checks.filter((check) => check.skipped);
  if (skipped.length > 0) {
    return `${of} skipped its ${skipped.map((c) => c.name).join(', ')} check: ${skipped.map((c) => c.summary).join(' ')}`;
  }
  let files: Map<string, Uint8Array>;
  try {
    files = readDistDir(join(projectDir, 'dist'));
  } catch {
    return `dist/ is missing or incomplete, so it does not hold the bundle \`boardsmith verify\` built for ${short(result.commit)}. ${VERIFY_AGAIN}`;
  }
  if (bundleDigest(files) !== result.checks.find((check) => check.name === 'build')?.bundle) {
    return (
      `dist/ is not the bundle \`boardsmith verify\` built for ${short(result.commit)}: something rebuilt or changed it since. ` +
      VERIFY_AGAIN
    );
  }
  return files;
}

const refused = (why: string) => ({
  problem: `${why}\nPublishing needs a full, passing \`boardsmith verify\` of this commit on a clean tree, and the dist/ it built.`,
});

/**
 * The commit to publish and the bundle verify built for it, or why it may not be published. Reads
 * only git and local files, so it runs before any key lookup or network call.
 */
export async function publishGate(projectDir: string): Promise<{ problem: string } | { commit: string; files: Map<string, Uint8Array> }> {
  const state = await checkoutState(projectDir);
  if ('problem' in state) return refused(state.problem);
  // verifiedProblem with no chunk refuses a chunk's fast checks: publish takes only the full verify.
  const problem = await verifiedProblem(projectDir);
  if (problem !== undefined) return refused(problem);
  // verifiedProblem refuses a missing or unreadable result, so this one is readable.
  const files = publishable(projectDir, (await readVerifyResult(projectDir, state.commit)) as VerifyResult);
  return typeof files === 'string' ? refused(files) : { commit: state.commit, files };
}
