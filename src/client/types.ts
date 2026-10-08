/**
 * The shape of the state a host sends one seat.
 *
 * `GameShell` receives it in the host's `game_state` message and hands it to
 * every board, so these are the types a custom UI reads.
 */

import type { ActionMetadata } from '../types/protocol.js';
import type { AnimationEvent, PublicFlowState, FollowUpOffer, TutorialStepView } from '../engine/index.js';
// Type-only (erased at runtime, no client -> session coupling in the emitted
// code). `PlayerState` below is the wire shape of the server's
// `PlayerGameState`, so borrowing the server's own payload types is what keeps
// the two from silently drifting apart again — see the fields at the end of
// PlayerState.
import type { SerializedFlowDebugInfo, SerializedPendingActionState } from '../session/types.js';

/**
 * What a seat is sent of the flow: the engine's `PublicFlowState`, never its
 * server-side `FlowState`, which counts every seat's actions (#449).
 * Re-exported rather than restated, so the client cannot drift from it.
 */
export type { PublicFlowState };

export interface PlayerState {
  /** Current game phase */
  phase: string;

  /** All players in the game */
  players: Array<{ name: string; seat: number }>;

  /** Current player's position (whose turn it is) */
  currentPlayer?: number;

  /** Actions available to the current player */
  availableActions: string[];

  /** Whether it's this player's turn */
  isMyTurn: boolean;

  /** Player's view of the game state (filtered for hidden information) */
  view: unknown;

  /** Animation events pending playback. Only present when events exist. */
  animationEvents?: AnimationEvent[];

  /** ID of the last animation event, for acknowledgment convenience. Only present when events exist. */
  lastAnimationEventId?: number;

  /** Action metadata for auto-UI generation, keyed by action name. Mirrors `PlayerGameState.actionMetadata`. */
  actionMetadata?: Record<string, ActionMetadata>;

  /** The follow-up the flow holds for this seat. Mirrors `PlayerGameState.followUp`. */
  followUp?: FollowUpOffer;

  /** Whether the player can undo (has made actions this turn) */
  canUndo?: boolean;

  /** Whether color selection is enabled for this game */
  colorSelectionEnabled?: boolean;

  /** Formatted game messages visible to this player */
  messages?: Array<{ text: string }>;

  /**
   * How many checkpoint restores (undo / rewind) this timeline has undergone.
   * Published unconditionally for every seat -- see
   * `PlayerGameState.restoreEpoch` (`src/session/types.ts`). A CHANGE means
   * every element id captured from the previous runner is stale; GameShell
   * hands it to `useTableActionWiring`, whose board bridge cancels the open pick.
   */
  restoreEpoch?: number;

  /**
   * Which game this is -- see `PlayerGameState.gameInstanceId`
   * (`src/session/types.ts`). A CHANGE means a different game replaced this
   * one; GameShell hands it to `useTableActionWiring` with `restoreEpoch`.
   */
  gameInstanceId?: string;

  /**
   * The seat this state was built for, `0` for a spectator -- see
   * `PlayerGameState.viewerSeat` (`src/session/types.ts`). Animation event ids
   * are numbered per seat, so a CHANGE restarts the animation watermark.
   */
  viewerSeat?: number;

  // The fields below are sent by the server (`PlayerGameState`, session/types.ts)
  // and consumed by GameShell, but were never declared here. Nothing caught the
  // drift because the `*.vue` shim typed every component as
  // `DefineComponent<object, object, unknown>`, so no template was type-checked;
  // GameShell had already resorted to an `as any` cast to read disabledActions.

  /**
   * Active tutorial step projected for this player, or `undefined` when no
   * tutorial is running for this seat. Mirrors `PlayerGameState.tutorial`.
   */
  tutorial?: TutorialStepView;

  /**
   * Action name → human-readable reason, for every action that is offered but
   * disabled — from the action's own `.disabled(ctx)` rule or the active
   * tutorial step's gate. `undefined` when nothing is disabled. Mirrors
   * `PlayerGameState.disabledActions`.
   */
  disabledActions?: Record<string, string>;

  /**
   * Serialized flow-position snapshot for the debug panel (FLOW-01). Mirrors
   * `PlayerGameState.flowDebugInfo`.
   */
  flowDebugInfo?: SerializedFlowDebugInfo;

  /**
   * This seat's OWN pending multi-step action snapshot (FLOW-03), or
   * `undefined` when none is in progress. Mirrors
   * `PlayerGameState.pendingAction` — always the per-seat value, never shared.
   */
  pendingAction?: SerializedPendingActionState;
}

export interface GameState {
  /** Flow state (turn info, available actions) */
  flowState: PublicFlowState;

  /** Player-specific state */
  state: PlayerState;

  /** This player's seat */
  playerSeat: number;

  /** Whether this seat is a spectator */
  isSpectator: boolean;
}
