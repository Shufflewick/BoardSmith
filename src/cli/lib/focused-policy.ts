import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type FocusedVerificationScope,
  focusedSelectionPath,
  focusedVerificationScope,
} from './authored-tests.js';
import { gitSucceeds } from './git-output.js';

const execute = promisify(execFile);

/** Resolves the committed opt-in and refuses a focused run while agent-policy requires full checks. */
export async function focusedPolicyScope(
  projectDir: string,
  { policyRevision = 'HEAD', selectionRevision = 'HEAD' }: { policyRevision?: string; selectionRevision?: string } = {},
): Promise<FocusedVerificationScope | undefined> {
  if (policyRevision === 'HEAD' && !await gitSucceeds(projectDir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])) return undefined;
  const path = await focusedSelectionPath(projectDir, policyRevision);
  if (path === undefined) return undefined;
  const scope = await focusedVerificationScope(projectDir, path, selectionRevision);
  let status: unknown;
  try {
    const { stdout } = await execute('agent-policy', ['ticket', 'status', '--json'], { cwd: projectDir, timeout: 30_000 });
    status = JSON.parse(stdout);
  } catch {
    throw new Error('Could not read the ticket verification deadline. Run `agent-policy ticket status --json` in this project and fix its reported problem before continuing.');
  }
  const repository = scope.selection.ticket.split('#')[0].toLowerCase();
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    throw new Error('agent-policy returned an invalid ticket verification status. Run `agent-policy ticket status --json` and restore its recorded closure history.');
  }
  const state = status as Record<string, unknown>;
  if (typeof state.repository !== 'string' || state.repository.toLowerCase() !== repository || state.fullEvery !== 5 ||
    !Number.isInteger(state.closedSinceFull) || (state.closedSinceFull as number) < 0 ||
    typeof state.fullDue !== 'boolean' || state.fullDue !== ((state.closedSinceFull as number) >= 5)) {
    throw new Error(`agent-policy returned an invalid ticket verification status for ${repository}. Run \`agent-policy ticket status --json\` and restore its recorded closure history.`);
  }
  if (state.fullDue) {
    throw new Error('Five implementation tickets have closed since the last full verification. Run `agent-policy verify` before continuing; authored tests cannot satisfy the full-run deadline.');
  }
  return scope;
}
