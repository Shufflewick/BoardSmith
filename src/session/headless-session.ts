import { SnapshotSessionHost } from './snapshot-session-host.js';
import { executeOp, SUBMISSION_OP_TYPES, type GameDefinitionLike, type Op } from './stateless-ops.js';
import { flowBoundaryKey, type BoundaryKeyState } from '../engine/flow/boundary-key.js';
import type { BotSeat, SnapshotSessionAdapters } from './snapshot-session-host.js';

/**
 * An op as a headless CALLER writes it: a submission may omit `boundaryKey`,
 * and {@link createHeadlessSession}'s `send` stamps the host's CURRENT key.
 *
 * That is correct here and ONLY here: this is an in-process driver that
 * composes and submits in the same tick, so there is no interval for a round to
 * close in — the same standing the bot pump and the demo loop have
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
type BroadcastMeta = Parameters<SnapshotSessionAdapters['record']>[1];

/**
 * Drives a SnapshotSessionHost with an IN-PROCESS executeOp, forcing every op
 * payload and every broadcast through structuredClone so non-cloneable data
 * throws exactly as postMessage would in the production iframe.
 *
 * Use this to run a game headlessly (no server, no browser) with seed control
 * and optional bot seats — e.g. for scripted simulation, agent-driven testing,
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
 *   [{ seat: 2, level: 'easy' }], // seat 2 is bot-driven
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
  botSeats: BotSeat[] = [],
) {
  const broadcasts: unknown[] = [];
  const metas: BroadcastMeta[] = [];
  const pushes: Array<ReadonlyArray<{ seat: number; view: unknown }>> = [];
  const spectatorViews: unknown[] = [];
  // The roster this harness owns. The positional `botSeats` argument seeds it,
  // and `makeSeatBot` below changes it mid-game, telling the host each time
  // (`setBotSeats`), as a platform does when a seat passes to the bot.
  const botRoster: BotSeat[] = [...botSeats];
  const host = new SnapshotSessionHost({
    playerCount: gameOptions.playerCount,
    // Debug ops run (#481): a headless session has one in-process caller
    // driving every seat, so there is no other player to keep a view from. A
    // seat-view debug op still answers only for the seat `send` names.
    debug: true,
    executeOp: (snap, pend, op) => executeOp(def, gameOptions, snap, pend, op, { debug: true }),
    record: (views, meta) => {
      // structuredClone here mirrors the production postMessage boundary: a
      // broadcast carrying a live game object would throw a DataCloneError.
      broadcasts.push(structuredClone(views.players));
      spectatorViews.push(structuredClone(views.spectator));
      // `meta` crosses the SAME boundary in production (the dev host's bridge
      // hands it to postGameState, the platform DO puts it on the wire), so it
      // is cloned for the same reason: a meta that is not structured-cloneable
      // would be a live defect, and this harness exists to surface exactly that.
      metas.push(structuredClone(meta));
    },
    push: (changed) => {
      pushes.push(structuredClone(changed));
    },
  });
  host.setBotSeats(botRoster);
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
     * What the host pushed, one entry per push: only the seats (0 = the
     * spectators) whose view changed (#487). {@link broadcasts} is the state
     * of record after every change, pushed or not.
     */
    pushes,
    /** The spectator's view of record, index-aligned with {@link broadcasts}. */
    spectatorViews,
    /**
     * Record on the ROSTER that `seat` is now bot-driven, exactly as the platform
     * DO's `mindSeats` flips `slots[seat].isBot`.
     *
     * This is HALF of a conversion. It tells the host the roster changed
     * (`setBotSeats()`), so every page learns it now rather than with some
     * later move (#487), but it does not wake the pump: the
     * `convertSeatToBot` op is what wakes the pump. Flipping the
     * roster and never sending the op leaves the table parked — send the op.
     * Sending the op without flipping the roster is refused loudly.
     *
     * Idempotent: a seat already on the roster keeps its existing entry.
     */
    makeSeatBot(seat: number, level?: string) {
      if (botRoster.some((s) => s.seat === seat)) return;
      botRoster.push({ seat, level });
      host.setBotSeats(botRoster);
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
