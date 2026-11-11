/** The log fields of a seat's `PlayerGameState`. */
interface LogState {
  messages?: unknown[];
  messageOffset?: number;
  messagesFrom?: number;
}

/**
 * The seat's state with its whole log, from the state the page holds and the
 * one just pushed (#1614).
 *
 * A host pushes only the log lines a page was not sent: `messages` then starts
 * at line `messagesFrom`, and the lines the page holds before that line are
 * unchanged. Call this on every `game_state` a page receives, with the state
 * it got from the last one, and keep what it returns: that is what to show and
 * to hand on (to `GameShell`, say), never the pushed state itself. A state
 * without `messagesFrom` carries its whole log and is returned as it is.
 */
export function mergeMessageLog<S extends LogState>(held: LogState | undefined, incoming: S): S {
  const from = incoming.messagesFrom;
  if (from === undefined) return incoming;
  const offset = incoming.messageOffset ?? 0;
  const heldOffset = held?.messageOffset ?? 0;
  const heldLines = held?.messages ?? [];
  if (heldOffset > offset || heldOffset + heldLines.length < from) {
    throw new Error(
      `The host sent game log lines from line ${from}, but this page holds lines ${heldOffset} to ${heldOffset + heldLines.length}, ` +
        'so it cannot show the whole log. The host must send a page the whole state of record when it connects, reconnects or changes seat.',
    );
  }
  const { messagesFrom: _, ...state } = incoming;
  const messages = [...heldLines.slice(offset - heldOffset, from - heldOffset), ...(incoming.messages ?? [])];
  return { ...state, ...(messages.length > 0 && { messages }) } as S;
}

/** A `game_state` frame's `view` (`{ flowState, state }`) with its state's whole log, from the view the page holds. */
export function mergeViewLog(held: unknown, view: unknown): unknown {
  const state = stateOf(view);
  return state ? { ...(view as object), state: mergeMessageLog(stateOf(held), state) } : view;
}

function stateOf(view: unknown): LogState | undefined {
  const state = (view as { state?: unknown } | null | undefined)?.state;
  return typeof state === 'object' && state !== null ? (state as LogState) : undefined;
}
