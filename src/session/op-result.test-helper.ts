/**
 * Narrowing an op's result in a test (#530).
 *
 * An op result is a union of its success and the shared refusal, and only the
 * success carries the game. A test that expects an op to succeed says so with
 * `succeeded(...)`: it fails with the refusal's own message when the op was
 * refused, and hands back the success typed for that op.
 */
import type { ExecutableOp, OpFailure } from './stateless-ops.js';
import type { ExecuteOpAdapter } from './snapshot-session-host.js';

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
 * An `executeOp` adapter built from a stub that answers with hand-built
 * results. The stub decides what each op answers, so its results are not
 * checked against each op's result type; the host checks what it reads.
 */
export function stubExecuteOp(
  stub: (snapshot: unknown, pendingState: Record<string, unknown> | null, op: ExecutableOp) => Promise<unknown>,
): ExecuteOpAdapter {
  return stub as ExecuteOpAdapter;
}
