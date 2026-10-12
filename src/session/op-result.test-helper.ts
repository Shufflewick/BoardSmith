/**
 * Narrowing an op's result in a test (#530).
 *
 * An op result is a union of its success and the shared refusal, and only the
 * success carries the game. A test that expects an op to succeed says so with
 * `succeeded(...)`: it fails with the refusal's own message when the op was
 * refused, and hands back the success typed for that op.
 */
import type { ExecutableOp, ExecutorOp, OpFailure, OpResultFor } from './stateless-ops.js';
import type { ExecuteOpAdapter } from './snapshot-session-host.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';

/** `result` as a success, or a thrown error naming why the op was refused. */
export function succeeded<R extends { success: boolean }>(result: R): Extract<R, { success: true }> {
  if (!result.success) {
    const failure = result as unknown as OpFailure;
    throw new Error(
      `Expected the op to succeed, but it was refused (${failure.category}` +
        `${failure.errorCode ? `, ${failure.errorCode}` : ''}): ${failure.error}`,
    );
  }
  return result as Extract<R, { success: true }>;
}

/** `result` as a refusal, or a thrown error when the op succeeded. */
export function refused<R extends { success: boolean }>(result: R): Extract<R, { success: false }> {
  if (result.success) throw new Error('Expected the op to be refused, but it succeeded.');
  return result as Extract<R, { success: false }>;
}

/**
 * The move a successful `botSuggest` found, as the `action` op the table host
 * makes it with (#635): for the bot's seat, stamped with the boundary of the
 * game the search ran on. Throws when the search found no move, naming the
 * stalled seat if one stalled.
 */
export function suggestedMoveOp(
  found: Extract<OpResultFor<'botSuggest'>, { success: true }>,
): Extract<ExecutorOp, { type: 'action' }> {
  if (found.botPlayer === undefined) {
    throw new Error(
      found.botStalled
        ? `Expected a bot move, but seat ${found.botStalled.seat} stalled: ${found.botStalled.reason}`
        : 'Expected a bot move, but no bot seat was due.',
    );
  }
  return {
    type: 'action',
    player: found.botPlayer,
    actionName: found.suggestedAction,
    args: found.suggestedArgs,
    boundaryKey: boundaryKeyOf(found.snapshot),
  };
}

/**
 * An `executeOp` adapter built from a stub that answers with hand-built
 * results. The stub decides what each op answers, so its results are not
 * checked against each op's result type; the host checks what it reads.
 */
export function stubExecuteOp(
  stub: (snapshot: unknown, pendingState: Record<string, unknown> | null, op: ExecutableOp) => Promise<unknown>,
): ExecuteOpAdapter {
  return stub as ExecuteOpAdapter;
}
