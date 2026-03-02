/**
 * PickHandler - Encapsulates pick choice resolution logic
 *
 * Extracted from GameSession to reduce cognitive load and improve testability.
 * Handles choice, element, elements, number, and text pick types.
 * A "pick" represents a choice the player must make during action resolution.
 */

import type { Game, Player } from '../engine/index.js';
import type { GameRunner } from '../runtime/index.js';
import {
  ErrorCode,
  type PickChoicesResponse,
  type ValidElement,
} from './types.js';

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

    // Helper function to generate default display
    const defaultDisplay = (value: unknown): string => {
      if (value === null || value === undefined) return String(value);
      if (typeof value !== 'object') return String(value);
      const obj = value as Record<string, unknown>;
      if (typeof obj.display === 'string') return obj.display;
      if (typeof obj.name === 'string') return obj.name;
      if (typeof obj.label === 'string') return obj.label;
      try { return JSON.stringify(value); } catch { return '[Complex Object]'; }
    };

    // Handle based on selection type
    switch (selection.type) {
      case 'choice': {
        const choiceSel = selection as any;
        let annotatedChoices: Array<{ value: unknown; disabled: string | false }>;
        try {
          annotatedChoices = executor.getChoices(selection, player, resolvedArgs) as Array<{ value: unknown; disabled: string | false }>;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          return { success: false, error: `Error evaluating choices: ${errorMsg}`, errorCode: ErrorCode.CHOICES_EVALUATION_ERROR };
        }

        // Convert to display format with board refs
        const formattedChoices = annotatedChoices.map(({ value: rawValue, disabled }) => {
          // Check if the choice already has { value, display } structure (e.g., from playerChoices())
          // If so, use those directly instead of wrapping again
          let value: unknown;
          let display: string;

          if (rawValue && typeof rawValue === 'object' && 'value' in rawValue && 'display' in rawValue) {
            // Already formatted choice (like from playerChoices)
            const formatted = rawValue as { value: unknown; display: string };
            value = formatted.value;
            display = formatted.display;
          } else {
            // Raw value - wrap it
            value = rawValue;
            display = choiceSel.display ? choiceSel.display(rawValue) : defaultDisplay(rawValue);
          }

          const choice: any = { value, display };

          // Add board refs if provided (pass the original rawValue for compatibility)
          if (choiceSel.boardRefs) {
            try {
              const refs = choiceSel.boardRefs(rawValue, ctx);
              if (refs.sourceRef) choice.sourceRef = refs.sourceRef;
              if (refs.targetRef) choice.targetRef = refs.targetRef;
            } catch (e) {
              console.error('boardRefs() error (ignored):', e);
            }
          }

          if (disabled !== false) {
            choice.disabled = disabled;
          }

          return choice;
        });

        // Evaluate multiSelect config if present
        let multiSelect: { min: number; max?: number } | undefined;
        if (choiceSel.multiSelect !== undefined) {
          const multiSelectConfig = typeof choiceSel.multiSelect === 'function'
            ? choiceSel.multiSelect(ctx)
            : choiceSel.multiSelect;

          if (multiSelectConfig !== undefined) {
            if (typeof multiSelectConfig === 'number') {
              multiSelect = { min: 1, max: multiSelectConfig };
            } else {
              multiSelect = {
                min: multiSelectConfig.min ?? 1,
                max: multiSelectConfig.max,
              };
            }
          }
        }

        return { success: true, choices: formattedChoices, multiSelect };
      }

      case 'element': {
        const elemSel = selection as any;
        let annotatedElements: Array<{ value: unknown; disabled: string | false }>;
        try {
          annotatedElements = executor.getChoices(selection, player, resolvedArgs) as Array<{ value: unknown; disabled: string | false }>;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          return { success: false, error: `Error evaluating elements: ${errorMsg}`, errorCode: ErrorCode.ELEMENTS_EVALUATION_ERROR };
        }

        // Build validElements list with display and refs
        const validElements = this.#buildValidElementsList(annotatedElements, elemSel, ctx);

        return { success: true, validElements };
      }

      case 'elements': {
        const elementsSel = selection as any;
        let annotatedElements: Array<{ value: unknown; disabled: string | false }>;
        try {
          annotatedElements = executor.getChoices(selection, player, resolvedArgs) as Array<{ value: unknown; disabled: string | false }>;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          return { success: false, error: `Error evaluating elements: ${errorMsg}`, errorCode: ErrorCode.ELEMENTS_EVALUATION_ERROR };
        }

        // Build validElements list with display and refs
        const validElements = this.#buildValidElementsList(annotatedElements, elementsSel, ctx);

        // Evaluate multiSelect config if present
        let multiSelect: { min: number; max?: number } | undefined;
        if (elementsSel.multiSelect !== undefined) {
          const multiSelectConfig = typeof elementsSel.multiSelect === 'function'
            ? elementsSel.multiSelect(ctx)
            : elementsSel.multiSelect;

          if (multiSelectConfig !== undefined) {
            if (typeof multiSelectConfig === 'number') {
              multiSelect = { min: 1, max: multiSelectConfig };
            } else {
              multiSelect = {
                min: multiSelectConfig.min ?? 1,
                max: multiSelectConfig.max,
              };
            }
          }
        }

        return { success: true, validElements, multiSelect };
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

  /**
   * Build validElements list with auto-disambiguation.
   * Used internally by getPickChoices.
   */
  #buildValidElementsList(
    annotatedElements: Array<{ value: unknown; disabled: string | false }>,
    elemSel: any,
    ctx: { game: Game; player: Player; args: Record<string, unknown> }
  ): ValidElement[] {
    const elements = annotatedElements.map(({ value }) => value) as Array<{ id: number; name?: string; notation?: string }>;

    // Auto-disambiguate display names
    const nameCounts = new Map<string, number>();
    for (const el of elements) {
      const name = el.name || 'Element';
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
    const nameIndices = new Map<string, number>();

    return annotatedElements.map(({ value: elementRaw, disabled }) => {
      const element = elementRaw as any;
      const validElem: any = { id: element.id };

      // Add display text if display function provided
      if (elemSel.display) {
        try {
          // Support both display signatures: (element, ctx) and (element, ctx, allElements)
          validElem.display = elemSel.display(element, ctx, elements);
        } catch {
          validElem.display = element.name || String(element.id);
        }
      } else {
        // Auto-disambiguation for elements with same name
        const baseName = element.name || 'Element';
        const count = nameCounts.get(baseName) || 1;
        if (count > 1) {
          const idx = (nameIndices.get(baseName) || 0) + 1;
          nameIndices.set(baseName, idx);
          validElem.display = `${baseName} #${idx}`;
        } else {
          // Default display: use element's name or notation if available
          validElem.display = element.notation || element.name || String(element.id);
        }
      }

      // Add board ref if provided
      if (elemSel.boardRef) {
        try {
          validElem.ref = elemSel.boardRef(element, ctx);
        } catch {
          // Ignore errors
        }
      } else {
        // Default ref: use element ID and notation if available
        validElem.ref = { id: element.id };
        if (element.notation) {
          validElem.ref.notation = element.notation;
        }
      }

      if (disabled !== false) {
        validElem.disabled = disabled;
      }

      return validElem;
    });
  }
}
