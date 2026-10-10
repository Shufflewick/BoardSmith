/**
 * PendingActionManager - Encapsulates pending action state machine
 *
 * Handles the step-by-step processing of actions with repeating selections.
 */

import type { FlowState, PendingActionState, Game, FollowUpOffer, PublicFlowState } from '../engine/index.js';
import { toPublicFlowState } from '../engine/index.js';
import type { GameRunner } from '../runtime/index.js';
import {
  ErrorCode,
  type PlayerGameState,
  type WarningEntry,
  type ChoiceWithRefs,
} from './types.js';
import { actionForSeat, buildPlayerState, offerFollowUp } from './utils.js';

/**
 * Result from processing a pick step.
 * A "pick" represents a choice the player must make during action resolution.
 */
export interface PickStepResult {
  success: boolean;
  error?: string;
  /**
   * Structured error code, forwarded from the underlying failure when one
   * exists (e.g. ACTION_NOT_FOUND from an auto-create). Undefined when no
   * upstream errorCode was produced — never fabricated.
   */
  errorCode?: ErrorCode;
  done?: boolean;
  nextChoices?: ChoiceWithRefs[];
  actionComplete?: boolean;
  actionResult?: {
    success: boolean;
    error?: string;
    flowState?: PublicFlowState;
    state?: PlayerGameState;
    /**
     * `ActionResult.data` from the completed multi-step action (BUG-017), so a
     * pick-driven action returns its computed value exactly like a single-step
     * one does.
     */
    data?: Record<string, unknown>;
    /** `ActionResult.message` from the completed multi-step action (BUG-012). */
    message?: string;
  };
  /** Mirrors `actionResult.data`, hoisted for callers that read the step result directly. */
  data?: Record<string, unknown>;
  /** Mirrors `actionResult.message`, hoisted for callers that read the step result directly. */
  message?: string;
  state?: PlayerGameState;
  /** The follow-up the completed action chained to, with its action's metadata. */
  followUp?: FollowUpOffer;
  /**
   * Structured warnings forwarded from an underlying pick response (e.g. a
   * throwing boardRefs()/display()/boardRef() encountered while formatting
   * choices for the next step). Never flips success:false. Undefined when
   * there are none — never fabricated.
   */
  warnings?: WarningEntry[];
}

/**
 * Manages pending actions for players.
 *
 * Handles the state machine for actions with repeating selections,
 * tracking progress through multi-step action flows.
 *
 * Every step that changes the game runs in one order: change the game, record
 * the op's checkpoint (`runner.captureCheckpoint()`), then build the state
 * returned to the acting seat. `canUndo` in that state asks the checkpoint
 * window whether the turn start is still retained (`decideUndo`), so a state
 * built before the checkpoint is recorded reads the window one step stale and
 * can offer an undo a small `checkpoints.max` has already dropped (#385).
 *
 * `PickHandler` builds one per selection step, seeded with the seat's pending
 * state, and the host persists what is left of it.
 */
export class PendingActionManager<G extends Game = Game> {
  readonly #runner: GameRunner<G>;
  readonly #playerCount: number;
  readonly #pendingActions: Map<number, PendingActionState> = new Map();

  constructor(runner: GameRunner<G>, playerCount: number) {
    this.#runner = runner;
    this.#playerCount = playerCount;
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
    const found = actionForSeat(this.#runner.game, this.#playerCount, playerPosition, actionName);
    if ('refusal' in found) return found.refusal;

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

    const refused = this.#refuseUnofferedAction(playerPosition, pendingState, actionName);
    if (refused) return refused;

    // Auto-create pending action if it doesn't exist and actionName is provided
    if (!pendingState && actionName) {
      const startResult = this.startPendingAction(actionName, playerPosition);
      if (!startResult.success) {
        return { success: false, error: startResult.error, errorCode: startResult.errorCode };
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
      return {
        success: false,
        error: 'No pending action for this player. Provide actionName to auto-create.',
        errorCode: ErrorCode.PICK_NOT_FOUND,
      };
    }

    const action = this.#runner.game.getAction(pendingState.actionName);
    if (!action) {
      return { success: false, error: `Action not found: ${pendingState.actionName}`, errorCode: ErrorCode.ACTION_NOT_FOUND };
    }

    const executor = this.#runner.game.getActionExecutor();
    const player = this.#runner.game.getPlayer(playerPosition);
    const selection = action.selections[pendingState.currentSelectionIndex];

    if (!selection) {
      return { success: false, error: 'No current selection', errorCode: ErrorCode.PICK_NOT_FOUND };
    }

    // Verify we're processing the expected selection
    if (selection.name !== selectionName) {
      return {
        success: false,
        error: `Expected selection at index ${pendingState.currentSelectionIndex}, got ${selectionName} at index ${action.selections.findIndex(s => s.name === selectionName)}`,
        errorCode: ErrorCode.PICK_NOT_FOUND,
      };
    }

    // Check if it's a repeating selection
    if (executor.isRepeatingSelection(selection)) {
      const result = executor.processRepeatingStep(action, player, pendingState, value);

      if (result.error) {
        return { success: false, error: result.error, nextChoices: result.nextChoices, errorCode: ErrorCode.INVALID_PICK };
      }

      // onEach may have modified game state.
      this.#runner.captureCheckpoint();

      // Check if the action is now complete
      if (result.done && executor.isPendingActionComplete(action, pendingState)) {
        return this.#completePendingAction(executor, action, player, pendingState, playerPosition);
      }

      // More selections needed
      this.#runner.notePickTaken(pendingState, playerPosition);
      return {
        success: true,
        done: result.done,
        nextChoices: result.nextChoices,
        warnings: result.warnings,
        actionComplete: false,
        state: this.#seatState(playerPosition),
      };
    }

    // Regular (non-repeating) selection
    const stepResult = executor.processSelectionStep(action, player, pendingState, selectionName, value);

    if (!stepResult.success) {
      return { success: false, error: stepResult.error, errorCode: ErrorCode.INVALID_PICK };
    }

    // Check if action is now complete
    if (executor.isPendingActionComplete(action, pendingState)) {
      return this.#completePendingAction(executor, action, player, pendingState, playerPosition);
    }

    this.#runner.notePickTaken(pendingState, playerPosition);

    // onSelect may have modified game state (e.g. animation events).
    this.#runner.captureCheckpoint();

    // More selections needed
    return {
      success: true,
      done: true,
      actionComplete: false,
      state: this.#seatState(playerPosition),
    };
  }

  /**
   * Get the current pending action for a player.
   */
  getPendingAction(playerPosition: number): PendingActionState | undefined {
    return this.#pendingActions.get(playerPosition);
  }

  /**
   * Seed a pending action's state directly. Used by stateless hosts (e.g. the
   * ShufflewickPub executor) that persist the pending state externally between
   * selection steps and restore it before each step.
   */
  setPendingAction(playerPosition: number, state: PendingActionState): void {
    this.#pendingActions.set(playerPosition, state);
  }

  /**
   * Cancel a pending action for a player.
   */
  cancelPendingAction(playerPosition: number): void {
    const pendingState = this.#pendingActions.get(playerPosition);
    if (pendingState) {
      // Fire onCancel for selections where onSelect had fired
      const action = this.#runner.game.getAction(pendingState.actionName);
      if (action) {
        const executor = this.#runner.game.getActionExecutor();
        executor.fireOnCancelCallbacks(action, pendingState);
      }
      this.#pendingActions.delete(playerPosition);
    }
  }

  /**
   * Nothing of a pending action may run unless the flow offers it to this
   * seat now: not on a finished game, and not as another seat's move (#492),
   * and not once another seat's move took its condition away (#493,
   * `GameRunner.refusalToPick`). The action is the open pending one, else the
   * one about to be started. With neither there is nothing to check; the
   * caller reports that.
   */
  #refuseUnofferedAction(
    playerPosition: number,
    pendingState: PendingActionState | undefined,
    actionName: string | undefined,
  ): PickStepResult | undefined {
    const name = pendingState?.actionName ?? actionName;
    if (!name) return undefined;
    const refusal = this.#runner.refusalToPick(name, playerPosition, pendingState);
    return refusal && { success: false, error: refusal.error, errorCode: refusal.errorCode };
  }

  /** The acting seat's state after a step, as the step result returns it. */
  #seatState(playerPosition: number): PlayerGameState {
    return buildPlayerState(this.#runner, [], playerPosition, { includeActionMetadata: true });
  }

  async #completePendingAction(
    executor: ReturnType<Game['getActionExecutor']>,
    action: any,
    player: any,
    pendingState: PendingActionState,
    playerPosition: number,
  ): Promise<PickStepResult> {
    // Serialize the completed action BEFORE executing it, mirroring
    // GameRunner.performAction (serialize-then-execute): the recorded element
    // refs must reflect the positions the action acts on so replay/clone can
    // re-resolve them. The fully-collected multi-step args live in
    // pendingState.collectedArgs.
    //
    // This is the UNIQUE completion path for multi-step / repeating-selection
    // actions (single-step actions go through performAction), so recording here
    // neither double-records nor misses any path. We push only after a
    // successful execute (below) to avoid recording a failed action.
    this.#runner.bindFollowUpArgs(pendingState, playerPosition);
    const serializedAction = this.#runner.serializeForHistory(
      action.name,
      player,
      pendingState.collectedArgs,
    );

    const actionResult = executor.executePendingAction(action, player, pendingState);
    this.#pendingActions.delete(playerPosition);

    if (actionResult.success) {
      // Route the completed pending action through the same recording funnel as
      // performAction so actionHistory is the single source of truth for what
      // happened (replay, undo counts, and bot history all read it).
      this.#runner.recordSerializedAction(serializedAction);
      this.#runner.game.continueFlowAfterPendingAction(actionResult, playerPosition);
      this.#runner.captureCheckpoint();
    }

    const flowState = this.#runner.getFlowState();
    return {
      success: actionResult.success,
      error: actionResult.error,
      done: true,
      actionComplete: true,
      actionResult: {
        success: actionResult.success,
        error: actionResult.error,
        flowState: toPublicFlowState(flowState),
        state: this.#seatState(playerPosition),
        data: actionResult.data,
        message: actionResult.message,
      },
      state: this.#seatState(playerPosition),
      followUp: offerFollowUp(this.#runner.game, flowState, playerPosition),
      // Hoisted beside followUp so a multi-step action's return value reaches
      // the ops layer on the same footing as a single-step one (BUG-017).
      data: actionResult.data,
      message: actionResult.message,
    };
  }
}
