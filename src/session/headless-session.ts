import { SnapshotSessionHost } from './snapshot-session-host.js';
import {
  executeOp,
  runnerFromSnapshot,
  SUBMISSION_OP_TYPES,
  type GameDefinitionLike,
  type Op,
  type OpOfType,
  type OpResultFor,
} from './stateless-ops.js';
import { flowBoundaryKey, type BoundaryKeyState } from '../engine/flow/boundary-key.js';
import type { Game, GameClass } from '../engine/index.js';
import type { BotSeat, SnapshotSessionAdapters } from './snapshot-session-host.js';
import type { GameOptionSelection } from './game-option-selection.js';
import type { PlayerGameState } from './types.js';

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

/** The headless op of type `T`, so `send` answers with that op's own result. */
type HeadlessOpOf<T extends Op['type']> = { [K in T]: WithOptionalBoundary<OpOfType<K>> }[T];

/** The `meta` object the host hands to every broadcast, captured verbatim. */
type BroadcastMeta = Parameters<SnapshotSessionAdapters['record']>[1];

/** One seat's published view, as the host hands it to `record`. */
interface SeatView {
  state: PlayerGameState;
}

/** How a headless table is set up: who sits at it, the seed, and the game options chosen. */
export interface HeadlessGameOptions {
  playerCount: number;
  seed?: string;
  playerNames?: string[];
  /** The players' choice of the game's declared options, admitted by `selectGameOptions`. */
  options?: GameOptionSelection;
  /**
   * Lock the teaching tools (hints, the move-quality heatmap, the demo and the
   * tutorial) for the whole session, as a host does for a ranked table. Both
   * the host and the executor refuse them, and every seat is told.
   */
  teachingDisabled?: boolean;
}

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
export function createHeadlessSession<G extends Game = Game>(
  def: GameDefinitionLike & { gameClass: GameClass<G> },
  tableOptions: HeadlessGameOptions,
  botSeats: BotSeat[] = [],
) {
  const { options, teachingDisabled, ...table } = tableOptions;
  // The players' choice first and the table's own fields after it, so a
  // selection cannot name the seat count, the names or the seed.
  const gameOptions = { ...options, ...table };
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
    teachingDisabled,
    executeOp: (snap, pend, op) => executeOp(def, gameOptions, snap, pend, op, { debug: true, teachingDisabled }),
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
  function currentSnapshot() {
    const snapshot = host.snapshot;
    if (!snapshot) throw new Error('The table has no game yet. Call start() before reading or arranging it.');
    return snapshot;
  }
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
    async send<T extends Op['type']>(seat: number, op: HeadlessOpOf<T>): Promise<OpResultFor<T>> {
      structuredClone(op); // throws DataCloneError if a payload carries a non-cloneable game object
      // Stamp the host's CURRENT boundary only when the caller supplied none.
      // Never `??` over a supplied key — an explicit key, including a stale one,
      // is the caller's statement of which round it composed against.
      const needsStamp =
        SUBMISSION_OP_TYPES.has(op.type) && (op as { boundaryKey?: string }).boundaryKey === undefined;
      // With its key stamped, the op is the `T` op the host takes.
      const stamped = (
        needsStamp
          ? { ...op, boundaryKey: flowBoundaryKey(host.flowState as BoundaryKeyState | null) }
          : op
      ) as OpOfType<T>;
      return host.handleOp(seat, stamped);
    },
    /**
     * `seat`'s state of record: what the host last published to that seat,
     * read again after every move the way a page receives a broadcast.
     */
    playerState(seat: number): PlayerGameState {
      const views = broadcasts.at(-1) as SeatView[] | undefined;
      if (!views) {
        throw new Error('The table has not published a state yet. Call start() before reading a seat.');
      }
      if (!Number.isInteger(seat) || seat < 1 || seat > views.length) {
        throw new Error(`There is no seat ${seat} at this table; it has seats 1 to ${views.length}.`);
      }
      return views[seat - 1].state;
    },
    /**
     * A copy of the game as it stands now, rebuilt from the host's snapshot
     * the way every op rebuilds it. Read from it; an edit to it changes
     * nothing at the table. To set up a position, use {@link arrange}.
     */
    readGame(): G {
      return runnerFromSnapshot(currentSnapshot(), { ...def, randomness: 'allowed' }).game as G;
    },
    /**
     * Set up a position between moves: `edit` changes a copy of the game, and
     * the table then restores that copy as a debug restore does, so every
     * seat is published the new position and the next move plays from it.
     */
    async arrange(edit: (game: G) => void): Promise<void> {
      const runner = runnerFromSnapshot(currentSnapshot(), { ...def, randomness: 'allowed' });
      edit(runner.game as G);
      const result = await host.handleOp(1, { type: 'restoreEarlier', snapshot: runner.getSnapshot() });
      if (!result.success) throw new Error(`The arranged position could not be restored: ${result.error}`);
    },
  };
}

/** A table {@link createHeadlessSession} returns, playing a `G`: name it to pass one to a test helper. */
export type HeadlessSession<G extends Game = Game> = ReturnType<typeof createHeadlessSession<G>>;
