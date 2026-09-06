/**
 * PickHandler - Encapsulates pick choice resolution logic
 *
 * Extracted from GameSession to reduce cognitive load and improve testability.
 * Handles choice, element, elements, number, and text pick types.
 * A "pick" represents a choice the player must make during action resolution.
 */

import type { Game, Player, PendingActionState } from '../engine/index.js';
import type { GameRunner } from '../runtime/index.js';
import {
  ErrorCode,
  type PickChoicesResponse,
  type ValidElement,
  type StoredGameState,
  type WarningEntry,
} from './types.js';
import { PendingActionManager, type PickStepResult } from './pending-action-manager.js';
import { buildSingleActionMetadata } from './utils.js';
import {
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

    // Enrich a chained followUp with metadata (same as the dev session does), so
    // the embedded UI can render the next action's selections — e.g. taking one
    // item from a stash chains back to the same action with full metadata.
    if (result.followUp) {
      const player = this.#runner.game.getPlayer(playerPosition);
      const metadata = player
        ? buildSingleActionMetadata(this.#runner.game, player, result.followUp.action, result.followUp.args)
        : undefined;
      result.followUp = { ...result.followUp, metadata } as typeof result.followUp;
    }

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
      case 'choice': {
        let annotatedChoices: AnnotatedCandidate[];
        try {
          annotatedChoices = executor.getChoices(selection, player, resolvedArgs) as AnnotatedCandidate[];
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          return { success: false, error: `Error evaluating choices: ${errorMsg}`, errorCode: ErrorCode.CHOICES_EVALUATION_ERROR };
        }

        const choices = formatChoiceCandidates(annotatedChoices, selection, ctx, warnings);
        const multiSelect = resolveMultiSelectConfig(selection.multiSelect, ctx);

        return { success: true, choices, multiSelect, warnings: warnings.length > 0 ? warnings : undefined };
      }

      // ONE BRANCH FOR BOTH ELEMENT PICKS. They differ in exactly one thing --
      // `elements` resolves to an array and carries a multiSelect config -- and
      // two bodies that agreed about everything else is how they came to
      // disagree about a label.
      case 'element':
      case 'elements': {
        let annotatedElements: AnnotatedCandidate[];
        try {
          annotatedElements = executor.getChoices(selection, player, resolvedArgs) as AnnotatedCandidate[];
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          return { success: false, error: `Error evaluating elements: ${errorMsg}`, errorCode: ErrorCode.ELEMENTS_EVALUATION_ERROR };
        }

        const validElements = formatElementCandidates(annotatedElements, selection, ctx, warnings);
        const multiSelect =
          selection.type === 'elements'
            ? resolveMultiSelectConfig(selection.multiSelect, ctx)
            : undefined;

        return { success: true, validElements, multiSelect, warnings: warnings.length > 0 ? warnings : undefined };
      }

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
