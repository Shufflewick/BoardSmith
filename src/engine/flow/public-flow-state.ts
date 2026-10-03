import type { FlowState, PlayerAwaitingState } from './types.js';

/**
 * The part of a {@link FlowState} that every seat and spectator is sent.
 *
 * A session hands each seat its flow state on every broadcast, and the whole
 * `FlowState` counts actions: `moveCount` (also inside the position's frame
 * data), `movesRemaining`/`movesRequired`, the position's `turnRun`. In a
 * simultaneous step those counts are the total across every seat, so a seat
 * that knew its own actions could subtract and count another seat's SECRET
 * ones (#449). The full state stays on the server, where undo needs it; this
 * is what crosses the wire.
 *
 * It is an allowlist. A field added to `FlowState` does not reach a client
 * until it is added here, and anything added here is sent to every seat.
 */
export interface PublicFlowState {
  /**
   * Where the flow is. `path` is what `flowBoundaryKey` reads; `frameData`
   * keeps only each frame's `eligibleSeats`, the running order `turnSequence`
   * reads.
   */
  position: {
    path: number[];
    frameData?: Record<string, { eligibleSeats: number[] }>;
  };
  complete: boolean;
  awaitingInput: boolean;
  /** The seat acting in a sequential step. */
  currentPlayer?: number;
  /** The actions that step offers `currentPlayer`. */
  availableActions?: string[];
  /** Every seat a simultaneous step is awaiting, with each seat's own actions. */
  awaitingPlayers?: PlayerAwaitingState[];
  /** The current named phase. */
  currentPhase?: string;
  /** How long the open step stays open, in milliseconds, when it declared a limit. */
  timeLimitMs?: number;
}

/** Cut a server-side flow state down to what every seat and spectator may be sent. */
export function toPublicFlowState(flowState: FlowState): PublicFlowState;
export function toPublicFlowState(flowState: FlowState | undefined): PublicFlowState | undefined;
export function toPublicFlowState(flowState: FlowState | undefined): PublicFlowState | undefined {
  if (!flowState) return undefined;
  const pub: PublicFlowState = {
    position: { path: [...flowState.position.path] },
    complete: flowState.complete,
    awaitingInput: flowState.awaitingInput,
  };
  const orders = runningOrders(flowState.position.frameData);
  if (orders) pub.position.frameData = orders;
  if (flowState.currentPlayer !== undefined) pub.currentPlayer = flowState.currentPlayer;
  if (flowState.availableActions !== undefined) pub.availableActions = [...flowState.availableActions];
  if (flowState.awaitingPlayers !== undefined) {
    pub.awaitingPlayers = flowState.awaitingPlayers.map((p) => ({
      playerIndex: p.playerIndex,
      availableActions: [...p.availableActions],
      completed: p.completed,
    }));
  }
  if (flowState.currentPhase !== undefined) pub.currentPhase = flowState.currentPhase;
  if (flowState.timeLimitMs !== undefined) pub.timeLimitMs = flowState.timeLimitMs;
  return pub;
}

function runningOrders(
  frameData: Record<string, Record<string, unknown>> | undefined,
): Record<string, { eligibleSeats: number[] }> | undefined {
  if (!frameData) return undefined;
  const orders: Record<string, { eligibleSeats: number[] }> = {};
  let any = false;
  for (const [key, data] of Object.entries(frameData)) {
    const seats = data?.eligibleSeats;
    if (!Array.isArray(seats)) continue;
    orders[key] = { eligibleSeats: seats.filter((s): s is number => typeof s === 'number') };
    any = true;
  }
  return any ? orders : undefined;
}
