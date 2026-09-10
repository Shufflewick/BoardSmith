/**
 * The message a command failed with, for a test that has more than one thing to
 * say about it.
 *
 * `expect(p).rejects.toThrow(/x/)` is the right tool for a single assertion and
 * should stay. This exists for the other case: #240 turned the CLI's terminal
 * failures into thrown Errors so `cli.ts` renders them as one clean line, and a
 * test proving a message is actionable asserts several things about the same
 * one -- what it names, what it suggests, and that it leaks no stack frame or
 * internal path. Re-running the command once per assertion is both slow and a
 * different run each time; catching the rejection by hand at each call site is
 * the same six lines copied, which the duplication gate correctly reports.
 */
export async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw new Error(`Expected a rejection with an Error, got ${typeof error}: ${String(error)}`);
  }
  throw new Error('Expected the promise to reject, but it resolved.');
}
