import { SnapshotSessionHost } from './snapshot-session-host.js';
import { executeOp, SUBMISSION_OP_TYPES, type GameDefinitionLike, type Op } from './stateless-ops.js';
import { flowBoundaryKey, type BoundaryKeyState } from '../engine/flow/boundary-key.js';
import type { SnapshotSessionAdapters } from './snapshot-session-host.js';

/**
 * An op as a headless CALLER writes it: a submission may omit `boundaryKey`,
 * and {@link createHeadlessSession}'s `send` stamps the host's CURRENT key.
 *
 * That is correct here and ONLY here: this is an in-process driver that
 * composes and submits in the same tick, so there is no interval for a round to
 * close in — the same standing the AI pump and the demo loop have
 * (docs/simultaneous-and-interrupt-semantics.md §7). It is NOT a way to opt out
 * of the token: an explicitly supplied key is forwarded verbatim, which is how
 * `stale-submission.test.ts` submits a key that is deliberately not current.
 */
type WithOptionalBoundary<T> = T extends { boundaryKey: string }
  ? Omit<T, 'boundaryKey'> & { boundaryKey?: string }
  : T;
// Distributes over the `Op` union (naked type parameter), so each submission
// member keeps its OWN fields. A non-distributive `Omit<Extract<Op, ...>, ...>`
// would collapse `action` and `selectionStep` into their common keys and make
// `args`/`value` unrepresentable.
export type HeadlessOp = WithOptionalBoundary<Op>;

/** The `meta` object the host hands to every broadcast, captured verbatim. */
type BroadcastMeta = Parameters<SnapshotSessionAdapters['broadcast']>[1];

/**
 * Drives a SnapshotSessionHost with an IN-PROCESS executeOp, forcing every op
 * payload and every broadcast through structuredClone so non-cloneable data
 * throws exactly as postMessage would in the production iframe.
 *
 * Use this to run a game headlessly (no server, no browser) with seed control
 * and optional AI seats — e.g. for scripted simulation, agent-driven testing,
 * or reproducing a bug from a fixed seed.
 *
 * @example
 * ```typescript
 * import { createHeadlessSession } from 'boardsmith/session';
 * import { gameDefinition } from './my-game.js';
 *
 * const session = createHeadlessSession(
 *   gameDefinition,
 *   { playerCount: 2, seed: 'demo' },
 *   [{ seat: 2, level: 'easy' }], // seat 2 is AI-driven
 * );
 *
 * await session.start();
 * const result = await session.send(1, {
 *   type: 'action',
 *   actionName: 'move',
 *   player: 1,
 *   args: { to: 'b4' },
 * });
 *
 * console.log(result.success, session.broadcasts.length);
 *
 * // The engine's authoritative turn boundary for broadcast N is `metas[N]`:
 * console.log(session.metas.at(-1)?.turnBoundary.dueSeats);
 * ```
 */
export function createHeadlessSession(
  def: GameDefinitionLike,
  gameOptions: { playerCount: number; seed?: string },
  aiSeats: Array<{ seat: number; level?: string }> = [],
) {
  const broadcasts: unknown[] = [];
  const metas: BroadcastMeta[] = [];
  // The roster is a LIVE list this harness owns, handed to the host through a
  // GETTER — the same shape the platform DO supplies (`get aiSeats()` over
  // `slots[].isBot` + `mindedSeats`). The positional `aiSeats` argument seeds it;
  // it is not its identity, so `makeSeatAI` below can change it mid-game.
  //
  // Before this, the argument was passed straight through as a frozen array and
  // "seat 2 became AI at move 7" was not expressible in the engine's own harness
  // at all — which is why nothing had ever asserted that the engine plays a
  // converted seat, even though the pump re-reads the roster on every iteration
  // and always could.
  const aiRoster: Array<{ seat: number; level?: string }> = [...aiSeats];
  const host = new SnapshotSessionHost({
    playerCount: gameOptions.playerCount,
    get aiSeats() {
      return aiRoster;
    },
    executeOp: (snap, pend, op) => executeOp(def, gameOptions, snap, pend, op),
    broadcast: (views, meta) => {
      // structuredClone here mirrors the production postMessage boundary: a
      // broadcast carrying a live game object would throw a DataCloneError.
      broadcasts.push(structuredClone(views));
      // `meta` crosses the SAME boundary in production (the dev host's bridge
      // hands it to postGameState, the platform DO puts it on the wire), so it
      // is cloned for the same reason: a meta that is not structured-cloneable
      // would be a live defect, and this harness exists to surface exactly that.
      metas.push(structuredClone(meta));
    },
  });
  return {
    host,
    broadcasts,
    /**
     * The `meta` of each broadcast, index-aligned with {@link broadcasts}.
     * Carries `turnBoundary` — the engine's authoritative statement of which
     * seats owe a move, and in which boundary. Never reconstruct that from a
     * player view.
     */
    metas,
    /**
     * Record on the ROSTER that `seat` is now AI-driven, exactly as the platform
     * DO's `mindSeats` flips `slots[seat].isBot`.
     *
     * This is HALF of a conversion and deliberately does nothing on its own: the
     * roster is the adapter's, and the engine is told about the change by the
     * `convertSeatToAI` op, which is also what wakes the pump. Flipping the
     * roster and never sending the op leaves the table parked — send the op.
     * Sending the op without flipping the roster is refused loudly.
     *
     * Idempotent: a seat already on the roster keeps its existing entry.
     */
    makeSeatAI(seat: number, level?: string) {
      if (aiRoster.some((s) => s.seat === seat)) return;
      aiRoster.push({ seat, level });
    },
    async start() {
      await host.start();
    },
    async send(seat: number, op: HeadlessOp) {
      structuredClone(op); // throws DataCloneError if a payload carries a non-cloneable game object
      // Stamp the host's CURRENT boundary only when the caller supplied none.
      // Never `??` over a supplied key — an explicit key, including a stale one,
      // is the caller's statement of which round it composed against.
      const needsStamp =
        SUBMISSION_OP_TYPES.has(op.type) && (op as { boundaryKey?: string }).boundaryKey === undefined;
      const stamped = (
        needsStamp
          ? { ...op, boundaryKey: flowBoundaryKey(host.flowState as BoundaryKeyState | null) }
          : op
      ) as Op;
      return host.handleOp(seat, stamped);
    },
  };
}
