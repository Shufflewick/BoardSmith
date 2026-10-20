/**
 * PickHandler - Encapsulates pick choice resolution logic
 *
 * Handles choice, element, elements, number, and text pick types.
 * A "pick" represents a choice the player must make during action resolution.
 */

import type {
  ActionContext,
  ActionDefinition,
  ChoiceSelection,
  ElementSelection,
  ElementsSelection,
  Game,
  Player,
} from '../engine/index.js';
import { PlayerFacingError } from '../engine/errors.js';
import { rulesErrorSentence, withDevDetail } from '../engine/action/rules-error.js';
import type { GameRunner } from '../runtime/index.js';
import {
  ErrorCode,
  type PickChoicesResponse,
  type WarningEntry,
} from './types.js';
import type { ValidElement } from '../types/protocol.js';
import { PendingActionManager, type PickStepResult } from './pending-action-manager.js';
import { picksFromSeat } from '../engine/element/seat-placeholders.js';
import { actionForSeat, deserializePendingState, serializePendingActionState } from './utils.js';
import { resolveMultiSelect, resolveOrderedList } from '../engine/utils/resolve-multiselect.js';
import {
  deadEndPickMessage,
  formatChoiceCandidates,
  formatElementCandidates,
  type AnnotatedCandidate,
} from '../engine/element/pick-candidates.js';

/** The picks a pending action of `actionName` already holds, resolved to real elements when made. */
function picksHeldBy(pendingState: Record<string, unknown> | null, actionName: string): Record<string, unknown> {
  return pendingState?.actionName === actionName ? deserializePendingState(pendingState).collectedArgs : {};
}

/**
 * What the executor says this pick's candidates are, or the response that says
 * the game's own callback threw while being asked.
 *
 * Written once for both pick kinds: they differ in the word in the message and
 * in nothing else, and two copies of "what a throwing choices() becomes on the
 * wire" is how the two would come to answer it differently.
 */
function evaluateCandidates(
  executor: ReturnType<Game['getActionExecutor']>,
  actionName: string,
  selection: ChoiceSelection | ElementSelection | ElementsSelection,
  player: Player,
  args: Record<string, unknown>,
): { candidates: AnnotatedCandidate[] } | { refusal: PickChoicesResponse } {
  try {
    return { candidates: executor.getChoices(selection, player, args) as AnnotatedCandidate[] };
  } catch (error) {
    // The shared crash handling (#1045): a PlayerFacingError travels, anything else is logged and replaced.
    if (error instanceof PlayerFacingError) {
      return {
        refusal: {
          success: false,
          error: error.message,
          errorCode: selection.type === 'choice' ? ErrorCode.CHOICES_EVALUATION_ERROR : ErrorCode.ELEMENTS_EVALUATION_ERROR,
        },
      };
    }
    console.error(`[BoardSmith] Evaluating '${selection.name}' of action '${actionName}' failed:`, error);
    // A crash is ENGINE_ERROR, as on every other route (#1141), so a caller tells it from a refusal (#1156).
    return { refusal: { success: false, error: withDevDetail(rulesErrorSentence(actionName), error), errorCode: ErrorCode.ENGINE_ERROR } };
  }
}

/**
 * One pick with candidates, answered: its rows, its bounds, or the reason it
 * cannot be answered at all.
 *
 * ONE BODY FOR ALL THREE KINDS. A choice, an element and a set of elements
 * differ in which formatter draws their rows and in which bounds ride along --
 * and three bodies that agreed about everything else is how they came to
 * disagree about a label, and then about whether an empty step says anything.
 */
function answerPick(
  executor: ReturnType<Game['getActionExecutor']>,
  action: ActionDefinition,
  selection: ChoiceSelection | ElementSelection | ElementsSelection,
  player: Player,
  ctx: { game: Game; player: Player; args: Record<string, unknown> },
  warnings: WarningEntry[],
): PickChoicesResponse {
  const evaluated = evaluateCandidates(executor, action.name, selection, player, ctx.args);
  if ('refusal' in evaluated) return evaluated.refusal;

  // AFTER THE FORMATTERS RUN, NEVER BEFORE: a soft-failing `display()` or
  // `boardRefs()` is what puts anything in here, so reading the array early
  // would ship an answer that drops the very warnings it is meant to carry.
  const said = () => (warnings.length > 0 ? warnings : undefined);

  if (selection.type === 'choice') {
    const choices = formatChoiceCandidates(evaluated.candidates, selection, ctx, warnings);
    if (choices.length === 0 && !selection.optional) return deadEnd(action, selection, ctx);
    return {
      success: true,
      choices,
      multiSelect: resolveMultiSelect(selection, ctx),
      // The ORDERED-LIST bounds for THIS step (#249), resolved here for the
      // reason multiSelect is: a bound that reads an earlier selection's value
      // is only knowable once that value is bound, and the static metadata was
      // resolved with no arguments at all.
      orderedList: resolveOrderedList(selection, ctx),
      warnings: said(),
    };
  }

  const validElements = formatElementCandidates(evaluated.candidates, selection, ctx, warnings);
  if (validElements.length === 0 && !selection.optional) return deadEnd(action, selection, ctx);
  return {
    success: true,
    validElements,
    multiSelect: selection.type === 'elements'
      ? resolveMultiSelect(selection, ctx)
      : undefined,
    warnings: said(),
  };
}

/**
 * A STEP THE PLAYER REACHED AND CANNOT ANSWER (#270).
 *
 * An offered action can now walk a player to a later question that, with its
 * input bound, has nothing to pick -- which is the honest state of the game and
 * is exactly what the old pruning hid by deleting the verb. Drawing it as an
 * empty list under a prompt would trade one silence for another, so it refuses
 * on the channel a refused pick already travels (#227): both shells watch that
 * channel, so the action panel and a custom board say the same thing without
 * either of them learning a new field.
 *
 * Only a REQUIRED step, and only a genuinely EMPTY one. Skipping is the answer
 * to an optional step, and a step whose candidates are all greyed already tells
 * the player more than this could -- every row carries its own reason.
 */
function deadEnd(
  action: { name: string; prompt?: string },
  selection: { name: string; prompt?: unknown },
  ctx: { game: Game; player: Player; args: Record<string, unknown> },
): PickChoicesResponse {
  const prompt = typeof selection.prompt === 'function'
    ? (selection.prompt as (c: typeof ctx) => string)(ctx)
    : (selection.prompt as string | undefined);
  return {
    success: false,
    error: deadEndPickMessage({
      action: action.prompt ?? action.name,
      pick: prompt ?? selection.name,
      args: ctx.args,
      seat: ctx.player.seat,
    }),
    errorCode: ErrorCode.PICK_HAS_NO_CANDIDATES,
  };
}

/**
 * Handles pick choice resolution for game actions.
 *
 * This class encapsulates the logic for evaluating and returning choices
 * for different pick types (choice, element, elements, number, text).
 * A "pick" represents a choice the player must make.
 */
export class PickHandler<G extends Game = Game> {
  readonly #runner: GameRunner<G>;
  readonly #playerCount: number;

  constructor(runner: GameRunner<G>, playerCount: number) {
    this.#runner = runner;
    this.#playerCount = playerCount;
  }

  /**
   * Process one selection step for an action with a multi-step or repeating
   * selection, statelessly. The caller (e.g. the ShufflewickPub executor)
   * persists `priorPendingState` between steps and passes it back; on the first
   * step it is omitted and the pending action is auto-created from `actionName`
   * + `initialArgs`. Mutates the underlying game when a
   * step has side effects or completes the action, so the caller should read a
   * fresh snapshot afterwards.
   *
   * Returns the step result plus a JSON-safe `pendingState` to persist (null
   * once the action has completed and no pending state remains).
   */
  async processSelectionStep(
    playerPosition: number,
    selectionName: string,
    value: unknown,
    actionName?: string,
    initialArgs?: Record<string, unknown>,
    priorPendingState?: Record<string, unknown> | null,
  ): Promise<PickStepResult & { pendingState: Record<string, unknown> | null }> {
    const manager = new PendingActionManager(this.#runner, this.#playerCount);

    if (priorPendingState) {
      manager.setPendingAction(playerPosition, deserializePendingState(priorPendingState));
    }

    // What the seat sent, in the server's ids (#715); a pending action names its own action.
    const sentFor = actionName ?? (priorPendingState?.actionName as string | undefined);
    const fromSeat = (picks: Record<string, unknown>) => picksFromSeat(this.#runner.game, sentFor, picks, playerPosition);
    const result = await manager.processSelectionStep(
      playerPosition,
      selectionName,
      fromSeat({ [selectionName]: value })[selectionName],
      actionName,
      initialArgs && fromSeat(initialArgs),
    );

    const pending = manager.getPendingAction(playerPosition);
    return { ...result, pendingState: pending ? { ...serializePendingActionState(pending) } : null };
  }

  /**
   * Cancel a player's pending action (fires onCancel callbacks). Stateless:
   * the caller restores the pending state first.
   */
  cancelPendingAction(playerPosition: number, priorPendingState: Record<string, unknown> | null): void {
    if (!priorPendingState) return;
    const manager = new PendingActionManager(this.#runner, this.#playerCount);
    manager.setPendingAction(playerPosition, deserializePendingState(priorPendingState));
    manager.cancelPendingAction(playerPosition);
  }

  /**
   * Get choices for any pick.
   * This is the unified endpoint for fetching pick choices on-demand.
   * Called when advancing to a new pick in the action flow.
   *
   * @param actionName Name of the action
   * @param selectionName Name of the pick to get choices for
   * @param playerPosition Player requesting choices
   * @param currentArgs The picks made so far (for dependent picks); a key that
   *   names no pick is refused
   * @param pendingState The seat's persisted pending state, if any
   * @returns Choices/elements with display strings and board refs, plus multiSelect config
   */
  getPickChoices(
    actionName: string,
    selectionName: string,
    playerPosition: number,
    currentArgs: Record<string, unknown> = {},
    pendingState: Record<string, unknown> | null = null,
  ): PickChoicesResponse {
    const found = actionForSeat(this.#runner.game, this.#playerCount, playerPosition, actionName);
    if ('refusal' in found) return found.refusal;
    const refusal = this.#refusalToPick(actionName, playerPosition, pendingState);
    if (refusal) return refusal;
    const { action } = found;

    // Find the pick
    const selection = action.selections.find(s => s.name === selectionName);
    if (!selection) {
      return { success: false, error: `Pick not found: ${selectionName}`, errorCode: ErrorCode.PICK_NOT_FOUND };
    }

    // Build context with current args (playerPosition is 1-indexed seat number)
    const player = this.#runner.game.getPlayer(playerPosition);
    if (!player) {
      return { success: false, error: `Player not found at seat ${playerPosition}`, errorCode: ErrorCode.INVALID_PLAYER };
    }

    const executor = this.#runner.game.getActionExecutor();
    const sent = picksFromSeat(this.#runner.game, actionName, currentArgs, playerPosition);
    const asked = this.#choiceContext(action, player, sent, picksHeldBy(pendingState, actionName));
    if ('refusal' in asked) return asked.refusal;
    const { ctx } = asked;

    // Aggregated structured warnings for this call's soft-fail sites
    // (boardRefs()/display()/boardRef() throwing) — attached to the response
    // as a top-level array. Never flips success:false (T-126-08).
    const warnings: WarningEntry[] = [];

    // A number or text pick has no choices.
    if (selection.type === 'number' || selection.type === 'text') return { success: true };
    return answerPick(executor, action, selection, player, ctx, warnings);
  }

  /**
   * Why `seat` may not see this action's choices now, or `undefined`. Choices
   * can name what only other seats see, so only a seat the flow would let take
   * the pick is answered (#714). The pending state counts only for its own action.
   */
  #refusalToPick(
    actionName: string,
    seat: number,
    pendingState: Record<string, unknown> | null,
  ): PickChoicesResponse | undefined {
    const pending = pendingState?.actionName === actionName ? deserializePendingState(pendingState) : undefined;
    const refusal = this.#runner.refusalToPick(actionName, seat, pending);
    return refusal && { success: false, ...refusal };
  }

  /**
   * What a pick's choices see: the client's picks so far, with the picks the
   * pending action already holds and the seat's held follow-up's args bound
   * over them, resolved. A held pick wins because it is what the action will
   * take; the card it names may since have left the seat's sight, where the
   * client's placeholder for it names nothing (#715).
   * The client sends picks only, so any other key is refused (#662).
   */
  #choiceContext(
    action: ActionDefinition,
    player: Player,
    currentArgs: Record<string, unknown>,
    heldPicks: Record<string, unknown>,
  ): { ctx: ActionContext } | { refusal: PickChoicesResponse } {
    const executor = this.#runner.game.getActionExecutor();
    const refusal = executor.undeclaredArgsRefusal(action, currentArgs);
    if (refusal) return { refusal: { success: false, error: refusal, errorCode: ErrorCode.INVALID_PICK } };
    const bound = { ...currentArgs, ...heldPicks, ...this.#runner.followUpArgsFor(action.name, player.seat) };
    return { ctx: { game: this.#runner.game, player, args: executor.resolveArgs(action, bound, player) } };
  }
}
