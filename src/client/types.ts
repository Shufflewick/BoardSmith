/**
 * The shape of the state a host sends one seat.
 *
 * `GameShell` receives it in the host's `game_state` message and hands it to
 * every board, so these are the types a custom UI reads.
 */

import type { PublicFlowState } from '../engine/index.js';
// Type-only (erased at runtime, no client -> session coupling in the emitted
// code): the client's state IS the server's, so the two cannot drift (#1698).
import type { PlayerGameState } from '../session/types.js';

/**
 * What a seat is sent of the flow: the engine's `PublicFlowState`, never its
 * server-side `FlowState`, which counts every seat's actions (#449).
 * Re-exported rather than restated, so the client cannot drift from it.
 */
export type { PublicFlowState };

/** `state` is the session's `PlayerGameState`, exported by `boardsmith/session`. */
export interface GameState {
  /** Flow state (turn info, available actions) */
  flowState: PublicFlowState;

  /** Player-specific state */
  state: PlayerGameState;

  /** This player's seat */
  playerSeat: number;

  /** Whether this seat is a spectator */
  isSpectator: boolean;
}
