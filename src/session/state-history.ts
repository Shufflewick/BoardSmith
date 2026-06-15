/**
 * StateHistory class for time travel debugging and undo functionality.
 *
 * Encapsulates:
 * - getStateAtAction(): Restore state at a specific action index from checkpoints
 * - getStateDiff(): Compute element diff between two states
 * - getActionTraces(): Debug action availability
 * - undoToTurnStart(): Undo current turn
 * - rewindToAction(): Rewind to arbitrary point
 */

import { canSeatAct, availableActionsForSeat, type FlowState, type Game } from '../engine/index.js';
import { GameRunner } from '../runtime/index.js';
import {
  ErrorCode,
  type GameClass,
  type StoredGameState,
  type PlayerGameState,
} from './types.js';
import { buildPlayerState, computeUndoInfo, buildActionTraces, computeElementDiff } from './utils.js';

// ============================================
// Types
// ============================================

/**
 * Result of undoing actions
 */
export interface UndoResult {
  success: boolean;
  error?: string;
  /** Programmatic error code for switch statements. See ErrorCode enum. */
  errorCode?: ErrorCode;
  flowState?: FlowState;
  state?: PlayerGameState;
  /** Number of actions that were undone */
  actionsUndone?: number;
}

/**
 * Element-level diff between two game states
 */
export interface ElementDiff {
  /** Element IDs that were added */
  added: number[];
  /** Element IDs that were removed */
  removed: number[];
  /** Element IDs that changed (attributes, children, etc.) */
  changed: number[];
  /** The from action index */
  fromIndex: number;
  /** The to action index */
  toIndex: number;
}

/**
 * Callbacks for StateHistory to interact with GameSession
 */
export interface StateHistoryCallbacks<G extends Game = Game> {
  /** Replace the current runner with a new one (for undo/rewind) */
  replaceRunner: (newRunner: GameRunner<G>) => void;
  /** Save the stored state */
  save: () => Promise<void>;
  /** Broadcast state to all clients */
  broadcast: () => void;
}

// ============================================
// StateHistory Class
// ============================================

/**
 * Manages time travel debugging and undo functionality.
 */
export class StateHistory<G extends Game = Game> {
  #GameClass: GameClass<G>;
  #storedState: StoredGameState;
  #getRunner: () => GameRunner<G>;
  #callbacks: StateHistoryCallbacks<G>;

  constructor(
    GameClass: GameClass<G>,
    storedState: StoredGameState,
    getRunner: () => GameRunner<G>,
    callbacks: StateHistoryCallbacks<G>
  ) {
    this.#GameClass = GameClass;
    this.#storedState = storedState;
    this.#getRunner = getRunner;
    this.#callbacks = callbacks;
  }

  // ============================================
  // Time Travel Methods
  // ============================================

  /**
   * Get state at a specific action index (for time travel debugging).
   *
   * Restores AUTHORITATIVELY from the per-action checkpoint captured at that
   * action count — NOT by replaying actionHistory. Replay re-runs start() +
   * recorded actions, which never re-applies pending/selection mutations
   * (Piece.putInto, recorded in neither command nor action history): it loses
   * prior-turn equipment and mis-positions the flow, so it would silently show a
   * board that never actually existed. This shares the single restore primitive
   * (GameRunner.fromSnapshot + actionCheckpoints) with undoToTurnStart and the
   * stateless undo op. The live session accumulates these checkpoints via its
   * broadcast funnel.
   */
  getStateAtAction(actionIndex: number, playerPosition: number): { success: boolean; state?: PlayerGameState; error?: string } {
    const history = this.#storedState.actionHistory;

    // Validate index
    if (actionIndex < 0 || actionIndex > history.length) {
      return { success: false, error: `Invalid action index: ${actionIndex}. History has ${history.length} actions.` };
    }

    const snapshot = this.#getRunner().getSnapshot();
    const tempRunner = GameRunner.fromCheckpoint<G>(snapshot, actionIndex, this.#GameClass);
    if (!tempRunner) {
      return {
        success: false,
        error: `Cannot view state at action index ${actionIndex}: no checkpoint ` +
          `(have ${snapshot.actionCheckpoints?.length ?? 0}). The session accumulates per-action checkpoints as ` +
          `it runs; a session cold-restored from action history alone cannot time-travel across ` +
          `pending mutations.`,
      };
    }

    try {
      // Build state for the requested player (restored authoritatively above; no replay).
      const state = buildPlayerState(
        tempRunner,
        this.#storedState.playerNames,
        playerPosition,
        { includeActionMetadata: false }
      );

      return { success: true, state };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restore game state',
      };
    }
  }

  /**
   * Compute diff between two action points (for state diff highlighting)
   * Returns lists of element IDs that were added, removed, or changed
   */
  getStateDiff(
    fromIndex: number,
    toIndex: number,
    playerPosition: number
  ): { success: boolean; diff?: ElementDiff; error?: string } {
    const history = this.#storedState.actionHistory;

    // Validate indices
    if (fromIndex < 0 || fromIndex > history.length) {
      return { success: false, error: `Invalid fromIndex: ${fromIndex}` };
    }
    if (toIndex < 0 || toIndex > history.length) {
      return { success: false, error: `Invalid toIndex: ${toIndex}` };
    }

    try {
      // Get states at both points
      const fromResult = this.getStateAtAction(fromIndex, playerPosition);
      const toResult = this.getStateAtAction(toIndex, playerPosition);

      if (!fromResult.success || !fromResult.state) {
        return { success: false, error: fromResult.error || 'Failed to get from state' };
      }
      if (!toResult.success || !toResult.state) {
        return { success: false, error: toResult.error || 'Failed to get to state' };
      }

      // Compute the element-level diff between the two state views using the
      // shared helper (single source of truth with the stateless executor).
      const { added, removed, changed } = computeElementDiff(
        fromResult.state.view,
        toResult.state.view,
      );

      return {
        success: true,
        diff: { added, removed, changed, fromIndex, toIndex },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to compute diff',
      };
    }
  }

  /**
   * Get action traces for debugging (shows why actions are available/unavailable)
   * @param playerPosition Player's seat number
   */
  getActionTraces(playerPosition: number): {
    success: boolean;
    traces?: import('./types.js').ActionTrace[];
    flowContext?: {
      flowAllowedActions: string[];
      currentPlayer?: number;
      isMyTurn: boolean;
      currentPhase?: string;
    };
    error?: string;
  } {
    if (playerPosition < 1 || playerPosition > this.#storedState.playerCount) {
      return { success: false, error: `Invalid player seat: ${playerPosition}. Player seats are 1-indexed (1 to ${this.#storedState.playerCount}).` };
    }

    try {
      const runner = this.#getRunner();
      const traces = buildActionTraces(runner, playerPosition);

      // Get flow context to show which actions are restricted by flow.
      // Both "is it my turn" and "what may I do" come from the canonical
      // seat-activity predicates so simultaneous and sequential steps are
      // handled identically here and everywhere else.
      const flowState = runner.getFlowState();
      const isMyTurn = canSeatAct(flowState, playerPosition);
      const flowAllowedActions = availableActionsForSeat(flowState, playerPosition);

      return {
        success: true,
        traces,
        flowContext: {
          flowAllowedActions,
          currentPlayer: flowState?.currentPlayer,
          isMyTurn,
          currentPhase: flowState?.currentPhase,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get action traces',
      };
    }
  }

  // ============================================
  // Undo Methods
  // ============================================

  /**
   * Undo actions back to the start of the current player's turn.
   * Only works if it's the player's turn and they've made at least one action.
   */
  async undoToTurnStart(playerPosition: number): Promise<UndoResult> {
    // Validate player seat (1-indexed)
    if (playerPosition < 1 || playerPosition > this.#storedState.playerCount) {
      return { success: false, error: `Invalid player: ${playerPosition}. Player seats are 1-indexed (1 to ${this.#storedState.playerCount}).`, errorCode: ErrorCode.INVALID_PLAYER };
    }

    const runner = this.#getRunner();

    // Check if it's this player's turn
    const flowState = runner.getFlowState();
    if (flowState?.currentPlayer !== playerPosition) {
      return { success: false, error: "It's not your turn", errorCode: ErrorCode.NOT_YOUR_TURN };
    }

    // Compute where the turn started
    const { turnStartActionIndex, actionsThisTurn } = computeUndoInfo(
      this.#storedState.actionHistory,
      flowState.currentPlayer
    );

    // Check if there's anything to undo
    if (actionsThisTurn === 0) {
      return { success: false, error: 'No actions to undo', errorCode: ErrorCode.NO_ACTIONS_TO_UNDO };
    }

    // Restore the turn-start state AUTHORITATIVELY from the per-action checkpoint
    // captured at that action count — NOT by replaying actionHistory. Replay
    // re-runs start() + recorded actions, which never re-applies pending/selection
    // mutations (Piece.putInto, recorded in neither command nor action history):
    // it loses prior-turn equipment and mis-positions the flow (a later action by
    // another player then throws "Not Player N's turn"). The runner accumulates
    // these checkpoints via GameSession's broadcast funnel.
    const snapshot = runner.getSnapshot();

    try {
      // Restore the checkpoint, carrying its prefix forward so further undos work.
      const newRunner = GameRunner.fromCheckpoint<G>(snapshot, turnStartActionIndex, this.#GameClass);
      if (!newRunner) {
        return {
          success: false,
          error: `Cannot undo: no turn-start checkpoint at action index ${turnStartActionIndex} ` +
            `(have ${snapshot.actionCheckpoints?.length ?? 0}). The session accumulates per-action checkpoints as ` +
            `it runs; a session cold-restored from action history alone cannot undo across pending mutations.`,
          errorCode: ErrorCode.NO_ACTIONS_TO_UNDO,
        };
      }

      // Replace the current runner via callback
      this.#callbacks.replaceRunner(newRunner);

      // Update stored action history to the restored point
      this.#storedState.actionHistory = newRunner.actionHistory;

      // Persist and broadcast
      await this.#callbacks.save();
      this.#callbacks.broadcast();

      const newFlowState = newRunner.getFlowState();

      return {
        success: true,
        flowState: newFlowState,
        state: buildPlayerState(newRunner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
        actionsUndone: actionsThisTurn,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to undo',
      };
    }
  }

  /**
   * Rewind the game to a specific action index and continue from there.
   * All actions after the target index will be discarded.
   * This is intended for debug/development use.
   */
  async rewindToAction(targetActionIndex: number): Promise<{
    success: boolean;
    error?: string;
    actionsDiscarded?: number;
    state?: PlayerGameState;
    newRunner?: GameRunner<G>;
  }> {
    const currentLength = this.#storedState.actionHistory.length;

    // Validate target index
    if (targetActionIndex < 0) {
      return { success: false, error: `Invalid action index: ${targetActionIndex}` };
    }

    if (targetActionIndex >= currentLength) {
      return { success: false, error: `Cannot rewind forward: target ${targetActionIndex} >= current ${currentLength}` };
    }

    const actionsDiscarded = currentLength - targetActionIndex;

    // Restore the target state AUTHORITATIVELY from the per-action checkpoint —
    // NOT by replaying actionHistory. Replay re-runs start() + recorded actions,
    // which never re-applies pending/selection mutations (Piece.putInto, recorded
    // in neither command nor action history): it loses prior-turn equipment and
    // mis-positions the flow, so rewind would resurrect a corrupted/mis-positioned
    // live game. This shares the single restore primitive (GameRunner.fromSnapshot
    // + actionCheckpoints) with undoToTurnStart and the stateless undo op.
    const snapshot = this.#getRunner().getSnapshot();

    try {
      // Restore the checkpoint, carrying its prefix forward so further undos/rewinds work.
      const newRunner = GameRunner.fromCheckpoint<G>(snapshot, targetActionIndex, this.#GameClass);
      if (!newRunner) {
        return {
          success: false,
          error: `Cannot rewind to action index ${targetActionIndex}: no checkpoint ` +
            `(have ${snapshot.actionCheckpoints?.length ?? 0}). The session accumulates per-action checkpoints as ` +
            `it runs; a session cold-restored from action history alone cannot rewind across ` +
            `pending mutations.`,
        };
      }

      // Replace current runner via callback
      this.#callbacks.replaceRunner(newRunner);

      // Update stored action history to the restored point
      this.#storedState.actionHistory = newRunner.actionHistory;

      // Persist and broadcast
      await this.#callbacks.save();
      this.#callbacks.broadcast();

      // Return state for the first player (caller should handle their own player position)
      return {
        success: true,
        actionsDiscarded,
        state: buildPlayerState(newRunner, this.#storedState.playerNames, 1, { includeActionMetadata: true, includeDebugData: true }),
        newRunner, // Return the new runner so GameSession can update handlers
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to rewind',
      };
    }
  }
}
