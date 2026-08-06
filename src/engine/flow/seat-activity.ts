/**
 * Canonical "who can act right now?" predicates over a flow state.
 *
 * A {@link FlowState} carries two representations of who may act:
 *   - `awaitingPlayers[]` for simultaneous-action steps, and
 *   - `currentPlayer` for ordinary sequential steps.
 *
 * These helpers are the single source of truth for collapsing those two
 * representations into a straight answer. Every consumer (the engine, the
 * session host, the AI controller, the MCTS bot, debug tooling) routes through
 * here instead of re-deriving the `awaitingPlayers ?? currentPlayer` branch, so
 * the simultaneous-vs-sequential invariant lives in exactly one place.
 *
 * The input is intentionally structural (not the concrete `FlowState`) so the
 * same predicates work on serialized flow states received over the wire.
 */

/** The minimal flow-state shape these predicates read. */
export interface SeatActivityState {
  /** Whether the flow is currently awaiting player input. */
  awaitingInput?: boolean;
  /** The seat acting in a sequential step, if any. */
  currentPlayer?: number;
  /** Actions available to the current sequential player. */
  availableActions?: string[];
  /** Per-seat state during a simultaneous step. */
  awaitingPlayers?: Array<{
    playerIndex: number;
    availableActions: string[];
    completed: boolean;
  }>;
  /**
   * Serialized flow position. Only `frameData` is read here — see
   * {@link turnSequence}, which recovers the running order an `eachPlayer` node
   * already resolved.
   */
  position?: {
    frameData?: Record<string, Record<string, unknown>>;
  };
}

/**
 * The seats of the current round, in the order they will act.
 *
 * `eachPlayer` resolves its running order ONCE per round — applying
 * `direction`, `startingPlayer`, and `filter` — and parks the result in its
 * frame as `eligibleSeats` (see `engine.ts`, `executeEachPlayer`). That array is
 * the game's real turn order, and it is already serialized to every client.
 * This reads it back rather than re-deriving one.
 *
 * Do NOT confuse this with `Game.nextPlayer()`, which is a hardcoded SEAT
 * successor (`sortBy('seat')`, then `idx + 1`). For any game whose turn order is
 * not seat order — a rotating dealer, a reversed round, a rank-ordered co-op —
 * `nextPlayer()` and this function give different answers, and this one is the
 * order the flow will actually take.
 *
 * Nested `eachPlayer` frames resolve to the INNERMOST one: with a round loop
 * outside a bidding loop, the bidding order is the one currently being played.
 *
 * Returns `[]` when the flow has no resolved order to report — a simultaneous
 * step, a `forEach` over something other than players, or a game whose turn
 * structure is hand-rolled. An empty result means "unknown", never "no seats";
 * callers must fall back rather than treat it as an ordering.
 */
export function turnSequence(flowState: SeatActivityState | undefined | null): number[] {
  const frameData = flowState?.position?.frameData;
  if (!frameData) return [];

  // Frames are keyed `__frame_<depth>`; deeper frames have higher indices, so
  // the highest-numbered frame carrying an order is the innermost active one.
  let deepest = -1;
  let sequence: number[] = [];
  for (const [key, data] of Object.entries(frameData)) {
    const seats = data?.eligibleSeats;
    if (!Array.isArray(seats)) continue;
    const depth = Number.parseInt(key.replace('__frame_', ''), 10);
    if (!Number.isFinite(depth) || depth <= deepest) continue;
    deepest = depth;
    sequence = seats.filter((s): s is number => typeof s === 'number');
  }
  return sequence;
}

/**
 * Arrange every seat for display, following `sequence` where it says anything.
 *
 * Two properties this must never violate, because the caller is rendering the
 * player list and a player who vanishes from it is worse than a mis-ordered one:
 * - **Total.** Every seat in `allSeats` appears exactly once. A `filter`ed
 *   `eachPlayer` legitimately omits seats from its running order (a folded
 *   player still has cards, chips, and a name to show); those seats follow the
 *   sequence in seat order rather than disappearing.
 * - **Duplicate-free.** A seat named twice by a malformed sequence appears once.
 */
export function orderSeatsByTurn(allSeats: number[], sequence: number[]): number[] {
  const present = new Set(allSeats);
  const ordered: number[] = [];
  const placed = new Set<number>();

  for (const seat of sequence) {
    if (!present.has(seat) || placed.has(seat)) continue;
    ordered.push(seat);
    placed.add(seat);
  }
  for (const seat of [...allSeats].sort((a, b) => a - b)) {
    if (!placed.has(seat)) ordered.push(seat);
  }
  return ordered;
}

/**
 * The seats that may act right now, in canonical order.
 *
 * - Simultaneous step: every awaiting seat that is not yet completed and still
 *   has at least one available action, in `awaitingPlayers` order.
 * - Sequential step: the single `currentPlayer`, if one is set.
 * - Not awaiting input: none.
 */
export function dueSeats(flowState: SeatActivityState | undefined | null): number[] {
  if (!flowState?.awaitingInput) return [];

  if (flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
    return flowState.awaitingPlayers
      .filter(p => !p.completed && p.availableActions.length > 0)
      .map(p => p.playerIndex);
  }

  return flowState.currentPlayer !== undefined ? [flowState.currentPlayer] : [];
}

/**
 * Whether the given seat may act right now. The one canonical answer to
 * "can seat N act?" — handles both simultaneous and sequential steps.
 */
export function canSeatAct(
  flowState: SeatActivityState | undefined | null,
  seat: number,
): boolean {
  return dueSeats(flowState).includes(seat);
}

/**
 * The actions the given seat may take right now, or `[]` if the seat cannot
 * act. Mirrors {@link canSeatAct}: a seat that cannot act has no actions.
 */
export function availableActionsForSeat(
  flowState: SeatActivityState | undefined | null,
  seat: number,
): string[] {
  if (!flowState?.awaitingInput) return [];

  if (flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
    const playerState = flowState.awaitingPlayers.find(p => p.playerIndex === seat);
    return playerState && !playerState.completed && playerState.availableActions.length > 0
      ? playerState.availableActions
      : [];
  }

  return flowState.currentPlayer === seat ? (flowState.availableActions ?? []) : [];
}
