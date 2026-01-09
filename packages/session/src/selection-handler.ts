/**
 * SelectionHandler - Encapsulates selection choice resolution logic
 *
 * Extracted from GameSession to reduce cognitive load and improve testability.
 * Handles choice, element, elements, number, and text selection types.
 */

import type { Game, Player } from '@boardsmith/engine';
import type { GameRunner } from '@boardsmith/runtime';
import {
  ErrorCode,
  type SelectionChoicesResponse,
  type ValidElement,
} from './types.js';

/**
 * Handles selection choice resolution for game actions.
 *
 * This class encapsulates the logic for evaluating and returning choices
 * for different selection types (choice, element, elements, number, text).
 */
export class SelectionHandler<G extends Game = Game> {
  readonly #runner: GameRunner<G>;
  readonly #playerCount: number;

  constructor(runner: GameRunner<G>, playerCount: number) {
    this.#runner = runner;
    this.#playerCount = playerCount;
  }

  /**
   * Update the runner reference (needed after hot reload)
   */
  updateRunner(runner: GameRunner<G>): SelectionHandler<G> {
    return new SelectionHandler(runner, this.#playerCount);
  }

  /**
   * Get choices for any selection.
   * This is the unified endpoint for fetching selection choices on-demand.
   * Called when advancing to a new selection in the action flow.
   *
   * @param actionName Name of the action
   * @param selectionName Name of the selection to get choices for
   * @param playerPosition Player requesting choices
   * @param currentArgs Arguments collected so far (for dependent selections)
   * @returns Choices/elements with display strings and board refs, plus multiSelect config
   */
  getSelectionChoices(
    actionName: string,
    selectionName: string,
    playerPosition: number,
    currentArgs: Record<string, unknown> = {}
  ): SelectionChoicesResponse {
    // Validate player position (1-indexed)
    if (playerPosition < 1 || playerPosition > this.#playerCount) {
      return { success: false, error: `Invalid player: ${playerPosition}. Player positions are 1-indexed (1 to ${this.#playerCount}).`, errorCode: ErrorCode.INVALID_PLAYER };
    }

    // Get action definition
    const action = this.#runner.game.getAction(actionName);
    if (!action) {
      return { success: false, error: `Action not found: ${actionName}`, errorCode: ErrorCode.ACTION_NOT_FOUND };
    }

    // Find the selection
    const selection = action.selections.find(s => s.name === selectionName);
    if (!selection) {
      return { success: false, error: `Selection not found: ${selectionName}`, errorCode: ErrorCode.SELECTION_NOT_FOUND };
    }

    // Build context with current args (playerPosition is 1-indexed)
    const player = this.#runner.game.players.get(playerPosition);
    if (!player) {
      return { success: false, error: `Player not found at position ${playerPosition}. Expected 1 to ${this.#runner.game.players.length}.`, errorCode: ErrorCode.INVALID_PLAYER };
    }

    // Resolve any element IDs in currentArgs to actual elements
    // Handles both plain numbers (id) and serialized element objects ({ id: number, ... })
    const resolvedArgs: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(currentArgs)) {
      if (typeof value === 'number') {
        // Plain element ID
        const element = this.#runner.game.getElementById(value);
        resolvedArgs[key] = element || value;
      } else if (typeof value === 'object' && value !== null && 'id' in value && typeof (value as { id: unknown }).id === 'number') {
        // Serialized element object from followUp args (e.g., { id: 123, name: 'Coffee Industry' })
        // When an action returns followUp.args with elements, they get JSON-serialized.
        // The client sends them back as objects, so we need to resolve them here.
        const element = this.#runner.game.getElementById((value as { id: number }).id);
        resolvedArgs[key] = element || value;
      } else {
        resolvedArgs[key] = value;
      }
    }

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

        // Evaluate choices NOW
        let choices: unknown[];
        if (typeof choiceSel.choices === 'function') {
          try {
            choices = choiceSel.choices(ctx);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: `Error evaluating choices: ${errorMsg}`, errorCode: ErrorCode.CHOICES_EVALUATION_ERROR };
          }
        } else {
          choices = choiceSel.choices || [];
        }

        // Convert to display format with board refs
        const formattedChoices = choices.map(rawValue => {
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
        let elements: any[];

        // Get elements - either from elements property or from/filter/elementClass pattern
        if (elemSel.elements) {
          if (typeof elemSel.elements === 'function') {
            try {
              elements = elemSel.elements(ctx);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              return { success: false, error: `Error evaluating elements: ${errorMsg}`, errorCode: ErrorCode.ELEMENTS_EVALUATION_ERROR };
            }
          } else {
            elements = elemSel.elements || [];
          }
        } else {
          // Original from/filter/elementClass pattern
          let from: any;

          if (typeof elemSel.from === 'function') {
            from = elemSel.from(ctx);
            // DEV WARNING: from function returned undefined/null - this will cause errors
            if (from === undefined || from === null) {
              if (process.env.NODE_ENV !== 'production') {
                console.warn(
                  `[BoardSmith] chooseElement '${selectionName}' from() returned ${from}.\n` +
                  `  This will cause errors. Check your from() function and ensure ctx.args has the expected values.\n` +
                  `  ctx.args: ${JSON.stringify(ctx.args)}`
                );
              }
              // Fall back to game to avoid crash, but this is likely a bug
              from = this.#runner.game;
            }
          } else {
            from = elemSel.from ?? this.#runner.game;
          }

          if (elemSel.elementClass) {
            elements = [...from.all(elemSel.elementClass)];
          } else {
            elements = [...from.all()];
          }

          if (elemSel.filter) {
            elements = elements.filter((e: any) => elemSel.filter!(e, ctx));
          }
        }

        // Build validElements list with display and refs
        const validElements = this.#buildValidElementsList(elements, elemSel, ctx);

        return { success: true, validElements };
      }

      case 'elements': {
        const elementsSel = selection as any;
        let elements: any[];

        if (typeof elementsSel.elements === 'function') {
          try {
            elements = elementsSel.elements(ctx);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            return { success: false, error: `Error evaluating elements: ${errorMsg}`, errorCode: ErrorCode.ELEMENTS_EVALUATION_ERROR };
          }
        } else {
          elements = elementsSel.elements || [];
        }

        // Build validElements list with display and refs
        const validElements = this.#buildValidElementsList(elements, elementsSel, ctx);

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
   * Used internally by getSelectionChoices.
   */
  #buildValidElementsList(
    elements: any[],
    elemSel: any,
    ctx: { game: Game; player: Player; args: Record<string, unknown> }
  ): ValidElement[] {
    // Auto-disambiguate display names
    const nameCounts = new Map<string, number>();
    for (const el of elements) {
      const name = el.name || 'Element';
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
    const nameIndices = new Map<string, number>();

    return elements.map((element: any) => {
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

      return validElem;
    });
  }
}
