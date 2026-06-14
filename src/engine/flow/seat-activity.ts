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
