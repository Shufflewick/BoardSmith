/**
 * PickHandler - Encapsulates pick choice resolution logic
 *
 * Extracted from GameSession to reduce cognitive load and improve testability.
 * Handles choice, element, elements, number, and text pick types.
 * A "pick" represents a choice the player must make during action resolution.
 */

import type {
  ActionDefinition,
  ChoiceSelection,
  ElementSelection,
  ElementsSelection,
  Game,
  Player,
  PendingActionState,
} from '../engine/index.js';
import type { GameRunner } from '../runtime/index.js';
import {
  ErrorCode,
  type PickChoicesResponse,
  type StoredGameState,
  type WarningEntry,
} from './types.js';
import type { ValidElement } from '../types/protocol.js';
import { PendingActionManager, type PickStepResult } from './pending-action-manager.js';
import { resolveOrderedList } from '../engine/utils/resolve-multiselect.js';
import {
  deadEndPickMessage,
  formatChoiceCandidates,
  formatElementCandidates,
  type AnnotatedCandidate,
} from '../engine/element/pick-candidates.js';

/** Serialize a pending action's state to a JSON-safe object (Set -> array). */
function serializePendingState(s: PendingActionState): Record<string, unknown> {
  return { ...s, onSelectFired: s.onSelectFired ? Array.from(s.onSelectFired) : undefined };
}

/** Restore a pending action's state from its JSON-safe form (array -> Set). */
function deserializePendingState(s: Record<string, unknown>): PendingActionState {
  const onSelectFired = s.onSelectFired;
  return {
    ...(s as unknown as PendingActionState),
    onSelectFired: Array.isArray(onSelectFired) ? new Set(onSelectFired as number[]) : undefined,
  };
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
  selection: ChoiceSelection | ElementSelection | ElementsSelection,
  player: Player,
  args: Record<string, unknown>,
): { candidates: AnnotatedCandidate[] } | { refusal: PickChoicesResponse } {
  try {
    return { candidates: executor.getChoices(selection, player, args) as AnnotatedCandidate[] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const asChoices = selection.type === 'choice';
    return {
      refusal: {
        success: false,
        error: `Error evaluating ${asChoices ? 'choices' : 'elements'}: ${message}`,
        errorCode: asChoices ? ErrorCode.CHOICES_EVALUATION_ERROR : ErrorCode.ELEMENTS_EVALUATION_ERROR,
      },
    };
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
  const evaluated = evaluateCandidates(executor, selection, player, ctx.args);
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
      multiSelect: resolveMultiSelectConfig(selection.multiSelect, ctx),
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
      ? resolveMultiSelectConfig(selection.multiSelect, ctx)
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
    }),
    errorCode: ErrorCode.PICK_HAS_NO_CANDIDATES,
  };
}

/**
 * A `multiSelect` config as the WIRE carries it: absent max means unlimited.
 *
 * Deliberately not `resolveMultiSelect` from the engine, which normalises an
 * unlimited maximum to `Infinity` for enumeration's arithmetic. `Infinity`
 * does not survive `JSON.stringify` -- it arrives as `null` -- so the wire
 * keeps the field absent instead, and this is the one place that decides it.
 */
function resolveMultiSelectConfig(
  multiSelect: unknown,
  ctx: { game: Game; player: Player; args: Record<string, unknown> },
): { min: number; max?: number } | undefined {
  if (multiSelect === undefined) return undefined;
  const config = typeof multiSelect === 'function'
    ? (multiSelect as (c: typeof ctx) => number | { min?: number; max?: number } | undefined)(ctx)
    : (multiSelect as number | { min?: number; max?: number });
  if (config === undefined) return undefined;
  if (typeof config === 'number') return { min: 1, max: config };
  return { min: config.min ?? 1, max: config.max };
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
   * Update the runner reference (needed after hot reload)
   */
  updateRunner(runner: GameRunner<G>): PickHandler<G> {
    return new PickHandler(runner, this.#playerCount);
  }

  /**
   * Process one selection step for an action with a multi-step or repeating
   * selection, statelessly. The caller (e.g. the ShufflewickPub executor)
   * persists `priorPendingState` between steps and passes it back; on the first
   * step it is omitted and the pending action is auto-created from `actionName`
   * + `initialArgs`. Reuses PendingActionManager (with no-op persistence) so the
   * behaviour matches the dev server exactly. Mutates the underlying game when a
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
    const storedState = {
      gameType: (this.#runner as unknown as { gameType?: string }).gameType ?? '',
      playerCount: this.#playerCount,
      playerNames: [],
      actionHistory: this.#runner.actionHistory,
      createdAt: 0,
    } as unknown as StoredGameState;

    const manager = new PendingActionManager(this.#runner, storedState, undefined, {
      save: async () => {},
      broadcast: () => {},
      scheduleBotCheck: () => {},
    });

    if (priorPendingState) {
      manager.setPendingAction(playerPosition, deserializePendingState(priorPendingState));
    }

    const result = await manager.processSelectionStep(
      playerPosition,
      selectionName,
      value,
      actionName,
      initialArgs,
    );

    const pending = manager.getPendingAction(playerPosition);
    return { ...result, pendingState: pending ? serializePendingState(pending) : null };
  }

  /**
   * Cancel a player's pending action (fires onCancel callbacks). Stateless:
   * the caller restores the pending state first.
   */
  cancelPendingAction(playerPosition: number, priorPendingState: Record<string, unknown> | null): void {
    if (!priorPendingState) return;
    const storedState = {
      gameType: (this.#runner as unknown as { gameType?: string }).gameType ?? '',
      playerCount: this.#playerCount,
      playerNames: [],
      actionHistory: this.#runner.actionHistory,
      createdAt: 0,
    } as unknown as StoredGameState;
    const manager = new PendingActionManager(this.#runner, storedState, undefined, {
      save: async () => {},
      broadcast: () => {},
      scheduleBotCheck: () => {},
    });
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
   * @param currentArgs Arguments collected so far (for dependent picks)
   * @returns Choices/elements with display strings and board refs, plus multiSelect config
   */
  getPickChoices(
    actionName: string,
    selectionName: string,
    playerPosition: number,
    currentArgs: Record<string, unknown> = {}
  ): PickChoicesResponse {
    // Validate player seat (1-indexed)
    if (playerPosition < 1 || playerPosition > this.#playerCount) {
      return { success: false, error: `Invalid player: ${playerPosition}. Player seats are 1-indexed (1 to ${this.#playerCount}).`, errorCode: ErrorCode.INVALID_PLAYER };
    }

    // Get action definition
    const action = this.#runner.game.getAction(actionName);
    if (!action) {
      return { success: false, error: `Action not found: ${actionName}`, errorCode: ErrorCode.ACTION_NOT_FOUND };
    }

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
    const resolvedArgs = executor.resolveArgs(action, currentArgs, player);

    const ctx = { game: this.#runner.game, player, args: resolvedArgs };

    // Aggregated structured warnings for this call's soft-fail sites
    // (boardRefs()/display()/boardRef() throwing) — attached to the response
    // as a top-level array. Never flips success:false (T-126-08).
    const warnings: WarningEntry[] = [];

    switch (selection.type) {
      case 'choice':
      case 'element':
      case 'elements':
        return answerPick(executor, action, selection, player, ctx, warnings);

      case 'number':
      case 'text':
        // These types don't have choices - return empty success
        return { success: true };

      default: {
        // Exhaustive check - this should never happen
        const _exhaustiveCheck: never = selection;
        return { success: false, error: `Unsupported selection type: ${(_exhaustiveCheck as any).type}` };
      }
    }
  }

}
