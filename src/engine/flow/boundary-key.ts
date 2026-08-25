/**
 * The canonical answer to "WHICH turn/round is this flow position?", as a
 * value.
 *
 * A turn boundary is an IDENTITY, not a membership. A 2-seat simultaneous round
 * that closes and re-opens has the due-seat set `[1, 2]` on both sides of the
 * boundary, so no comparison of seat sets — no matter how carefully written —
 * can see that a round ended. Every consumer that needs to know "is this still
 * the same round?" must compare {@link flowBoundaryKey} values. **A consumer
 * comparing seat sets to detect a boundary is doing it wrong**; that is the
 * defect this function exists to make unrepresentable.
 *
 * The input is intentionally structural (not the concrete `FlowState`), exactly
 * as {@link ./seat-activity.js seat-activity.ts}'s predicates are, so the same
 * key is computed by the engine, by the platform Durable Object, and by the
 * browser client — all of which hold a flow state that has crossed a
 * `structuredClone`/RPC boundary.
 *
 * ## Material included in the key, and why
 *
 * - **`complete`** — a finished flow gets ONE distinguished terminal key,
 *   distinct from every in-play key. A completed flow has an empty `path`,
 *   which is not otherwise distinguishable from a not-yet-started one.
 * - **`position.path`** — the frame index stack. This is what actually carries
 *   the boundary. For `loop`/`repeat`/`each-player`/`for-each`/`phase` frames
 *   the entry IS the iteration count (see `engine.ts`, `validatePath`), and
 *   `executeLoop`/`executeRepeat`/`executeEachPlayer` each do `frame.index++`
 *   when a round closes and the next opens. `restore()` rebuilds every frame's
 *   `index` verbatim from `position.path`, which is what makes the key survive
 *   a snapshot round trip unchanged.
 *
 * `path` is the ONLY material that carries the boundary, and it carries it
 * alone. It is a compact, ordered list of integers, so the key is cheap to
 * compute, cheap to compare, and trivially JSON-durable.
 *
 * ## Material deliberately EXCLUDED, and why
 *
 * - **`position.iterations`** — the `__iter_<depth>` counters. This was the
 *   obvious second candidate and it is WRONG, measured against
 *   `simultaneous-rounds-fixture.ts`: `getPosition()` emits an `__iter_<depth>`
 *   entry for every frame whose `data.iteration` happens to be set, and which
 *   frames those are depends on HOW the position was reached, not on where it
 *   is. Round 1 opens reporting `{__iter_1: 1}`; one seat then commits — no
 *   boundary crossed, `path` correctly unmoved at `[1,1,2,0]` — and the same
 *   position reports `{__iter_0: 0, __iter_1: 1, __iter_2: 0, __iter_3: 0}`.
 *   Including it would move the key mid-round, which is precisely the bug this
 *   primitive exists to prevent (see case 3 of `boundary-key.test.ts`, which
 *   fails on any key that includes it). `iterations` is not a second signal and
 *   not an escape hatch; it is noise.
 * - **`moveCount`** — advances on EVERY submission inside an open simultaneous
 *   round. Including it would move the key mid-round, re-stamping the round
 *   clock and re-notifying every seat each time one of them answered.
 * - **`awaitingPlayers` / `completed` / `currentPlayer`** — that is membership.
 *   It is exactly what cannot see a `[1,2] → [1,2]` boundary.
 * - **`frameData` and `variables`** — they carry game state. A key that moved
 *   when a game variable changed would not be a boundary. Excluding them also
 *   keeps the key free of any state that is not already public: `path` and
 *   `complete` both fan out to every seat and the spectator in `buildViews`
 *   already.
 */

/** The minimal flow-state shape this key is derived from. */
export interface BoundaryKeyState {
  /** Whether the flow has finished. Yields the distinguished terminal key. */
  complete?: boolean;
  /** Serialized flow position. ONLY `path` is read — see the header. */
  position?: {
    /** The frame index stack — the sole material that moves at a real boundary. */
    path?: number[];
  };
}

/** The key for a flow that has finished. */
const TERMINAL_KEY = 'flow:complete';

/** The key for "there is no flow state to speak of" — same tolerance `dueSeats` has. */
const UNKNOWN_KEY = 'flow:unknown';

/**
 * A durable, identity-bearing token naming which turn/round this flow position
 * is. Equal keys mean the same round; different keys mean the round moved.
 *
 * Tolerates `undefined`/`null` (returning a stable {@link UNKNOWN_KEY}) rather
 * than throwing, mirroring `dueSeats`.
 */
export function flowBoundaryKey(flowState: BoundaryKeyState | undefined | null): string {
  if (!flowState) return UNKNOWN_KEY;
  if (flowState.complete) return TERMINAL_KEY;

  const path = flowState.position?.path ?? [];
  return `flow:p=${path.join('.')}`;
}
