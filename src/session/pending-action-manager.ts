/**
 * PendingActionManager - Encapsulates pending action state machine
 *
 * Extracted from GameSession to reduce cognitive load and improve testability.
 * Handles the step-by-step processing of actions with repeating selections.
 */

import type { FlowState, PendingActionState, Game } from '../engine/index.js';
import type { GameRunner } from '../runtime/index.js';
import {
  ErrorCode,
  type StorageAdapter,
  type StoredGameState,
  type PlayerGameState,
} from './types.js';
import { buildPlayerState } from './utils.js';

/**
 * Callbacks for PendingActionManager to interact with GameSession.
 * Using callbacks avoids circular dependencies.
 */
export interface PendingActionCallbacks {
  /** Save the current state to storage */
  save(): Promise<void>;
  /** Broadcast state updates to all clients */
  broadcast(): void;
  /** Schedule an AI check (non-blocking) */
  scheduleAICheck(): void;
}

/**
 * Result from processing a pick step.
 * A "pick" represents a choice the player must make during action resolution.
 */
export interface PickStepResult {
  success: boolean;
  error?: string;
  done?: boolean;
  nextChoices?: unknown[];
  actionComplete?: boolean;
  actionResult?: {
    success: boolean;
    error?: string;
    flowState?: FlowState;
    state?: PlayerGameState;
  };
  state?: PlayerGameState;
}

/**
 * Manages pending actions for players.
 *
 * Handles the state machine for actions with repeating selections,
 * tracking progress through multi-step action flows.
 */
export class PendingActionManager<G extends Game = Game> {
  #runner: GameRunner<G>;
  readonly #storedState: StoredGameState;
  readonly #storage?: StorageAdapter;
  readonly #callbacks: PendingActionCallbacks;
  readonly #pendingActions: Map<number, PendingActionState> = new Map();

  constructor(
    runner: GameRunner<G>,
    storedState: StoredGameState,
    storage: StorageAdapter | undefined,
    callbacks: PendingActionCallbacks
  ) {
    this.#runner = runner;
    this.#storedState = storedState;
    this.#storage = storage;
    this.#callbacks = callbacks;
  }

  /**
   * Update the runner reference (needed after hot reload)
   */
  updateRunner(runner: GameRunner<G>): void {
    this.#runner = runner;
    // Clear pending actions when runner changes (they reference old game state)
    this.#pendingActions.clear();
  }

  /**
   * Start a pending action for a player.
   * Used when an action has repeating selections and needs step-by-step processing.
   */
  startPendingAction(actionName: string, playerPosition: number): {
    success: boolean;
    error?: string;
    errorCode?: ErrorCode;
    pendingState?: PendingActionState;
  } {
    if (playerPosition < 1 || playerPosition > this.#storedState.playerCount) {
      return { success: false, error: `Invalid player: ${playerPosition}. Player seats are 1-indexed (1 to ${this.#storedState.playerCount}).`, errorCode: ErrorCode.INVALID_PLAYER };
    }

    const action = this.#runner.game.getAction(actionName);
    if (!action) {
      return { success: false, error: `Action not found: ${actionName}`, errorCode: ErrorCode.ACTION_NOT_FOUND };
    }

    const executor = this.#runner.game.getActionExecutor();
    const pendingState = executor.createPendingActionState(actionName, playerPosition);
    this.#pendingActions.set(playerPosition, pendingState);

    return { success: true, pendingState };
  }

  /**
   * Process a selection step for a pending action.
   * Handles both regular selections and repeating selections.
   * Auto-creates the pending action if it doesn't exist.
   * @param initialArgs - Pre-collected args from earlier selections (e.g., actingMerc before equipment)
   */
  async processSelectionStep(
    playerPosition: number,
    selectionName: string,
    value: unknown,
    actionName?: string,
    initialArgs?: Record<string, unknown>
  ): Promise<PickStepResult> {
    let pendingState = this.#pendingActions.get(playerPosition);

    // Auto-create pending action if it doesn't exist and actionName is provided
    if (!pendingState && actionName) {
      const startResult = this.startPendingAction(actionName, playerPosition);
      if (!startResult.success) {
        return { success: false, error: startResult.error };
      }
      pendingState = startResult.pendingState;
      this.#pendingActions.set(playerPosition, pendingState!);

      // If initialArgs provided, populate the pending state and advance to correct selection
      if (initialArgs && Object.keys(initialArgs).length > 0) {
        const action = this.#runner.game.getAction(actionName);
        if (action) {
          // Copy initialArgs to collectedArgs (filter out null/undefined)
          for (const [key, val] of Object.entries(initialArgs)) {
            if (val !== undefined && val !== null) {
              pendingState!.collectedArgs[key] = val;
            }
          }

          // Find the index of the selection we're about to process
          const targetIndex = action.selections.findIndex(s => s.name === selectionName);
          if (targetIndex > 0) {
            pendingState!.currentSelectionIndex = targetIndex;
          }
        }
      }
    }

    if (!pendingState) {
      return { success: false, error: 'No pending action for this player. Provide actionName to auto-create.' };
    }

    const action = this.#runner.game.getAction(pendingState.actionName);
    if (!action) {
      return { success: false, error: `Action not found: ${pendingState.actionName}` };
    }

    const executor = this.#runner.game.getActionExecutor();
    const player = this.#runner.game.getPlayer(playerPosition);
    const selection = action.selections[pendingState.currentSelectionIndex];

    if (!selection) {
      return { success: false, error: 'No current selection' };
    }

    // Verify we're processing the expected selection
    if (selection.name !== selectionName) {
      return { success: false, error: `Expected selection at index ${pendingState.currentSelectionIndex}, got ${selectionName} at index ${action.selections.findIndex(s => s.name === selectionName)}` };
    }

    // Check if it's a repeating selection
    if (executor.isRepeatingSelection(selection)) {
      const result = executor.processRepeatingStep(action, player, pendingState, value);

      if (result.error) {
        return { success: false, error: result.error, nextChoices: result.nextChoices };
      }

      // Persist if storage adapter is provided (onEach may have modified game state)
      if (this.#storage) {
        await this.#callbacks.save();
      }

      // Broadcast state updates to all clients
      this.#callbacks.broadcast();

      // Check if the action is now complete
      if (result.done && executor.isPendingActionComplete(action, pendingState)) {
        // Execute the final action
        const actionResult = executor.executePendingAction(action, player, pendingState);
        this.#pendingActions.delete(playerPosition);

        if (actionResult.success) {
          // Continue the flow to update available actions
          this.#runner.game.continueFlowAfterPendingAction(actionResult);

          // Update stored action history
          this.#storedState.actionHistory = this.#runner.actionHistory;

          // Persist
          if (this.#storage) {
            await this.#callbacks.save();
          }

          // Broadcast
          this.#callbacks.broadcast();

          // Check if AI should respond
          this.#callbacks.scheduleAICheck();
        }

        return {
          success: actionResult.success,
          error: actionResult.error,
          done: true,
          actionComplete: true,
          actionResult: {
            success: actionResult.success,
            error: actionResult.error,
            flowState: this.#runner.getFlowState(),
            state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
          },
          state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
        };
      }

      // More selections needed
      return {
        success: true,
        done: result.done,
        nextChoices: result.nextChoices,
        actionComplete: false,
        state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
      };
    }

    // Regular (non-repeating) selection
    const stepResult = executor.processSelectionStep(action, player, pendingState, selectionName, value);

    if (!stepResult.success) {
      return { success: false, error: stepResult.error };
    }

    // Check if action is now complete
    if (executor.isPendingActionComplete(action, pendingState)) {
      const actionResult = executor.executePendingAction(action, player, pendingState);
      this.#pendingActions.delete(playerPosition);

      if (actionResult.success) {
        // Continue the flow to update available actions
        this.#runner.game.continueFlowAfterPendingAction(actionResult);

        // Update stored action history
        this.#storedState.actionHistory = this.#runner.actionHistory;

        // Persist
        if (this.#storage) {
          await this.#callbacks.save();
        }

        // Broadcast
        this.#callbacks.broadcast();

        // Check if AI should respond
        this.#callbacks.scheduleAICheck();
      }

      return {
        success: actionResult.success,
        error: actionResult.error,
        done: true,
        actionComplete: true,
        actionResult: {
          success: actionResult.success,
          error: actionResult.error,
          flowState: this.#runner.getFlowState(),
          state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
        },
        state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
      };
    }

    // More selections needed
    return {
      success: true,
      done: true,
      actionComplete: false,
      state: buildPlayerState(this.#runner, this.#storedState.playerNames, playerPosition, { includeActionMetadata: true, includeDebugData: true }),
    };
  }

  /**
   * Get the current pending action for a player.
   */
  getPendingAction(playerPosition: number): PendingActionState | undefined {
    return this.#pendingActions.get(playerPosition);
  }

  /**
   * Cancel a pending action for a player.
   */
  cancelPendingAction(playerPosition: number): void {
    this.#pendingActions.delete(playerPosition);
  }

  /**
   * Check if an action has repeating selections.
   */
  hasRepeatingSelections(actionName: string): boolean {
    const action = this.#runner.game.getAction(actionName);
    if (!action) return false;
    const executor = this.#runner.game.getActionExecutor();
    return executor.hasRepeatingSelections(action);
  }

  /**
   * Clear all pending actions (e.g., after hot reload)
   */
  clearAll(): void {
    this.#pendingActions.clear();
  }
}
