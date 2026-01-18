/**
 * StateHistory class for time travel debugging and undo functionality.
 *
 * Encapsulates:
 * - getStateAtAction(): Replay to a specific action index
 * - getStateDiff(): Compute element diff between two states
 * - getActionTraces(): Debug action availability
 * - undoToTurnStart(): Undo current turn
 * - rewindToAction(): Rewind to arbitrary point
 */

import type { FlowState, Game } from '@boardsmith/engine';
import { GameRunner } from '@boardsmith/runtime';
import {
  ErrorCode,
  type GameClass,
  type StoredGameState,
  type PlayerGameState,
} from './types.js';
import { buildPlayerState, computeUndoInfo, buildActionTraces } from './utils.js';

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
   * Get state at a specific action index (for time travel debugging)
   * Creates a temporary game and replays actions up to the specified index.
   */
  getStateAtAction(actionIndex: number, playerPosition: number): { success: boolean; state?: PlayerGameState; error?: string } {
    const history = this.#storedState.actionHistory;

    // Validate index
    if (actionIndex < 0 || actionIndex > history.length) {
      return { success: false, error: `Invalid action index: ${actionIndex}. History has ${history.length} actions.` };
    }

    try {
      // Get subset of actions to replay
      const actionsToReplay = history.slice(0, actionIndex);

      // Create a temporary runner and replay
      const tempRunner = GameRunner.replay<G>(
        {
          GameClass: this.#GameClass,
          gameType: this.#storedState.gameType,
          gameOptions: {
            playerCount: this.#storedState.playerCount,
            playerNames: this.#storedState.playerNames,
            seed: this.#storedState.seed,
            ...this.#storedState.gameOptions,
          },
        },
        actionsToReplay
      );

      // Build state for the requested player
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
        error: error instanceof Error ? error.message : 'Failed to replay game state',
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

      // Extract element IDs from view trees, tracking parent relationships
      // Map: element id -> { parentId, attributes (without children/player metadata) }
      const fromElements = new Map<number, { parentId: number | null; attrs: string }>();
      const toElements = new Map<number, { parentId: number | null; attrs: string }>();

      function getComparableAttrs(obj: Record<string, unknown>): string {
        // Only compare attributes that represent actual game state, not metadata
        const attrs = obj.attributes as Record<string, unknown> | undefined;
        if (!attrs) return '';
        // Filter out player objects and internal metadata
        const filtered: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(attrs)) {
          // Skip player objects and internal metadata
          if (key === 'player' || key === 'game' || key.startsWith('_')) continue;
          filtered[key] = value;
        }
        return JSON.stringify(filtered);
      }

      function collectElements(node: unknown, map: Map<number, { parentId: number | null; attrs: string }>, parentId: number | null = null) {
        if (!node || typeof node !== 'object') return;
        const obj = node as Record<string, unknown>;
        if (typeof obj.id === 'number') {
          map.set(obj.id, {
            parentId,
            attrs: getComparableAttrs(obj),
          });
          // Recurse into children with this node as parent
          if (Array.isArray(obj.children)) {
            for (const child of obj.children) {
              collectElements(child, map, obj.id);
            }
          }
        } else if (Array.isArray(obj.children)) {
          // Node without id, just recurse
          for (const child of obj.children) {
            collectElements(child, map, parentId);
          }
        }
      }

      collectElements(fromResult.state.view, fromElements);
      collectElements(toResult.state.view, toElements);

      // Compute diff - focus on elements that moved (parent changed) or whose attributes changed
      const added: number[] = [];
      const removed: number[] = [];
      const changed: number[] = [];

      for (const [id, toData] of toElements.entries()) {
        const fromData = fromElements.get(id);
        if (!fromData) {
          added.push(id);
        } else if (fromData.parentId !== toData.parentId || fromData.attrs !== toData.attrs) {
          // Element moved to different parent OR its attributes changed
          changed.push(id);
        }
      }

      for (const id of fromElements.keys()) {
        if (!toElements.has(id)) {
          removed.push(id);
        }
      }

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
   * @param playerPosition Player's position
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
      return { success: false, error: `Invalid player position: ${playerPosition}. Player positions are 1-indexed (1 to ${this.#storedState.playerCount}).` };
    }

    try {
      const runner = this.#getRunner();
      const traces = buildActionTraces(runner, playerPosition);

      // Get flow context to show which actions are restricted by flow
      const flowState = runner.getFlowState();
      let flowAllowedActions: string[] = [];
      let isMyTurn = false;

      if (flowState?.awaitingInput) {
        // Handle simultaneous actions
        if (flowState.awaitingPlayers && flowState.awaitingPlayers.length > 0) {
          const playerState = flowState.awaitingPlayers.find(p => p.playerIndex === playerPosition);
          if (playerState && !playerState.completed) {
            flowAllowedActions = playerState.availableActions;
            isMyTurn = true;
          }
        } else {
          // Regular turn-based flow
          flowAllowedActions = flowState.availableActions ?? [];
          isMyTurn = flowState.currentPlayer === playerPosition;
        }
      }

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
    // Validate player position (1-indexed)
    if (playerPosition < 1 || playerPosition > this.#storedState.playerCount) {
      return { success: false, error: `Invalid player: ${playerPosition}. Player positions are 1-indexed (1 to ${this.#storedState.playerCount}).`, errorCode: ErrorCode.INVALID_PLAYER };
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

    // Replay game to the turn start point
    const actionsToReplay = this.#storedState.actionHistory.slice(0, turnStartActionIndex);

    try {
      // Create a new runner replayed to the turn start
      const newRunner = GameRunner.replay<G>(
        {
          GameClass: this.#GameClass,
          gameType: this.#storedState.gameType,
          gameOptions: {
            playerCount: this.#storedState.playerCount,
            playerNames: this.#storedState.playerNames,
            seed: this.#storedState.seed,
            ...this.#storedState.gameOptions,
          },
        },
        actionsToReplay
      );

      // Replace the current runner via callback
      this.#callbacks.replaceRunner(newRunner);

      // Update stored action history
      this.#storedState.actionHistory = actionsToReplay;

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

    // Slice history to target point
    const actionsToReplay = this.#storedState.actionHistory.slice(0, targetActionIndex);
    const actionsDiscarded = currentLength - targetActionIndex;

    try {
      // Replay game to that point
      const newRunner = GameRunner.replay<G>(
        {
          GameClass: this.#GameClass,
          gameType: this.#storedState.gameType,
          gameOptions: {
            playerCount: this.#storedState.playerCount,
            playerNames: this.#storedState.playerNames,
            seed: this.#storedState.seed,
            ...this.#storedState.gameOptions,
          },
        },
        actionsToReplay
      );

      // Replace current runner via callback
      this.#callbacks.replaceRunner(newRunner);

      // Update stored action history
      this.#storedState.actionHistory = actionsToReplay;

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
