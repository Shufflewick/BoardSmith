/**
 * PendingActionManager - Encapsulates pending action state machine
 *
 * Handles the step-by-step processing of actions with repeating selections.
 */

import type { PendingActionState, Game, FollowUpOffer } from '../engine/index.js';
import type { GameRunner } from '../runtime/index.js';
import { pickFailureCode } from '../runtime/runner.js';
import {
  ErrorCode,
  type WarningEntry,
  type ChoiceWithRefs,
} from './types.js';
import { actionForSeat, deserializePendingState, offerFollowUp, serializePendingActionState } from './utils.js';

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
  /**
   * `ActionResult.data` from the completed multi-step action (BUG-017), so a
   * pick-driven action returns its computed value exactly like a single-step
   * one does.
   */
  data?: Record<string, unknown>;
  /** `ActionResult.message` from the completed multi-step action (BUG-012). */
  message?: string;
  /** A pick callback or `execute()` threw part way, so `runPickOp` says what it undid. */
  partiallyApplied?: boolean;
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
 * Every step that changes the game records the op's checkpoint
 * (`runner.captureCheckpoint()`). It builds no seat view: the caller builds
 * every view once, after the step (#813).
 *
 * `PickHandler` builds one per selection step, seeded with the seat's pending
 * state, and the host persists what is left of it.
 */
export class PendingActionManager<G extends Game = Game> {
  readonly #runner: GameRunner<G>;
  readonly #pendingActions: Map<number, PendingActionState> = new Map();

  constructor(runner: GameRunner<G>) {
    this.#runner = runner;
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
    const found = actionForSeat(this.#runner.game, playerPosition, actionName);
    if ('refusal' in found) return found.refusal;

    const executor = this.#runner.game.getActionExecutor();
    const pendingState = executor.createPendingActionState(actionName, playerPosition, true);
    // A held follow-up's published args are the engine's, bound before any
    // client pick, so every pick's callbacks see them.
    this.#runner.bindFollowUpArgs(pendingState, playerPosition);
    this.#pendingActions.set(playerPosition, pendingState);

    return { success: true, pendingState };
  }

  /**
   * Process a selection step for a pending action.
   * Handles both regular selections and repeating selections.
   * Auto-creates the pending action if it doesn't exist.
   * @param initialArgs - The picks the client made before this one, read only
   *   when this step starts the pending action, and made as its own steps would be
   *   (e.g., actingMerc before equipment)
   */
  async processSelectionStep(
    playerPosition: number,
    selectionName: string,
    value: unknown,
    actionName?: string,
    initialArgs?: Record<string, unknown>
  ): Promise<PickStepResult> {
    const pendingState = this.#pendingActions.get(playerPosition);

    const refused = this.#refuseUnofferedAction(playerPosition, pendingState, actionName);
    if (refused) return refused;
    if (pendingState) this.#runner.markStalePicks(pendingState, playerPosition);

    // A failed step keeps nothing: the game and this pending action are as before it (#1169).
    const before = pendingState && serializePendingActionState(pendingState);
    const { result, undone } = this.#runner.runPickOp(
      playerPosition,
      () => this.#takeStep(playerPosition, pendingState, selectionName, value, actionName, initialArgs),
    );
    if (undone && before) this.#pendingActions.set(playerPosition, deserializePendingState(before));
    if (undone && !before) this.#pendingActions.delete(playerPosition);
    return result;
  }

  #takeStep(
    playerPosition: number,
    pendingState: PendingActionState | undefined,
    selectionName: string,
    value: unknown,
    actionName: string | undefined,
    initialArgs: Record<string, unknown> | undefined,
  ): PickStepResult {
    // Auto-create pending action if it doesn't exist and actionName is provided
    if (!pendingState && actionName) {
      const startResult = this.startPendingAction(actionName, playerPosition);
      if (!startResult.success) {
        return { success: false, error: startResult.error, errorCode: startResult.errorCode };
      }
      pendingState = startResult.pendingState!;
      const refusal = this.#makeInitialPicks(pendingState, playerPosition, selectionName, initialArgs ?? {});
      if (refusal) return refusal;
    }

    if (!pendingState) {
      return {
        success: false,
        error: 'No pending action for this player. Provide actionName to auto-create.',
        errorCode: ErrorCode.PICK_NOT_FOUND,
      };
    }

    const taken = this.#runner.takePick(pendingState, playerPosition, selectionName, value);
    if (!taken.success) {
      return { success: false, error: taken.error, errorCode: taken.errorCode, nextChoices: taken.nextChoices, partiallyApplied: taken.partiallyApplied };
    }

    if (taken.complete) return this.#completePendingAction(pendingState, playerPosition);
    this.#runner.captureCheckpoint();

    return {
      success: true,
      done: taken.done,
      nextChoices: taken.nextChoices,
      warnings: taken.warnings,
      actionComplete: false,
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
   * Cancel a pending action for a player. Its `onCancel` callbacks may move
   * elements, so the game after them is checkpointed: a later action that
   * fails rolls back to the cancel, not to before it (#1253).
   */
  cancelPendingAction(playerPosition: number): void {
    if (this.#dropPendingAction(playerPosition)) this.#runner.captureCheckpoint();
  }

  /**
   * Drop a seat's pending action, running `onCancel` for each pick whose
   * `onSelect` ran. True if any did, when the game may have changed.
   */
  #dropPendingAction(playerPosition: number): boolean {
    const pendingState = this.#pendingActions.get(playerPosition);
    if (!pendingState) return false;
    this.#pendingActions.delete(playerPosition);
    const action = this.#runner.game.getAction(pendingState.actionName);
    if (!action || !pendingState.onSelectFired?.size) return false;
    this.#runner.game.getActionExecutor().fireOnCancelCallbacks(action, pendingState);
    return true;
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

  /**
   * Make the picks a client sent as `initialArgs` with the first step of a
   * new pending action: the picks it collected before `selectionName`, each
   * made as its own step would be, in order (#658). A pick a held follow-up
   * answered is the engine's and is not taken from the client, and an arg
   * that names no pick is refused (#662). A refusal cancels the action,
   * running `onCancel` for any `onSelect` that ran: `runPickOp` then undoes the
   * step whole, and with checkpoints off this is the only undo the step gets.
   */
  #makeInitialPicks(
    pendingState: PendingActionState,
    playerPosition: number,
    selectionName: string,
    initialArgs: Record<string, unknown>,
  ): PickStepResult | undefined {
    const game = this.#runner.game;
    const refused = game.getActionExecutor().makePicksBefore(
      game.getAction(pendingState.actionName)!, game.getPlayer(playerPosition)!, pendingState, selectionName, initialArgs,
    );
    if (refused === undefined) return undefined;
    // Inside the pick op, which restores its own checkpoint: no new one here.
    this.#dropPendingAction(playerPosition);
    return { success: false, error: refused.error, errorCode: pickFailureCode(refused) };
  }

  #completePendingAction(pendingState: PendingActionState, playerPosition: number): PickStepResult {
    // The UNIQUE completion path for multi-step / repeating-selection actions
    // on the session layer; the runner records, advances or rolls back.
    const actionResult = this.#runner.executeCollectedAction(pendingState, playerPosition);
    this.#pendingActions.delete(playerPosition);

    if (actionResult.success) this.#runner.captureCheckpoint();

    return {
      success: actionResult.success,
      error: actionResult.error,
      errorCode: actionResult.errorCode,
      done: true,
      actionComplete: true,
      followUp: offerFollowUp(this.#runner.game, this.#runner.getFlowState(), playerPosition),
      // Hoisted beside followUp so a multi-step action's return value reaches
      // the ops layer on the same footing as a single-step one (BUG-017).
      data: actionResult.data,
      message: actionResult.message,
      partiallyApplied: actionResult.partiallyApplied,
    };
  }
}
