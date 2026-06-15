import type { Game } from '../element/game.js';
import type { Player } from '../player/player.js';
import type { ActionContext } from './types.js';
import { isDevMode, devWarn } from '../../utils/dev.js';

// Re-export for backwards compatibility during transition
export { isDevMode, devWarn };

/**
 * Wrap a filter function to provide helpful error messages when it crashes
 * due to accessing undefined args properties.
 */
export function wrapFilterWithHelpfulErrors<T>(
  filter: (item: T, context: ActionContext) => boolean,
  selectionName: string
): (item: T, context: ActionContext) => boolean {
  return (item: T, context: ActionContext) => {
    try {
      return filter(item, context);
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('Cannot read properties of undefined')) {
        // Extract the property name from the error
        const match = error.message.match(/reading '(\w+)'/);
        const prop = match?.[1] || 'unknown';

        // Find which args are undefined (during availability check)
        const argsKeys = Object.keys(context.args || {});
        const undefinedArgs = argsKeys.filter(k => context.args[k] === undefined);

        if (undefinedArgs.length > 0 || argsKeys.length === 0) {
          const undefinedList = undefinedArgs.length > 0
            ? undefinedArgs.join(', ')
            : '(no previous selections made yet)';

          throw new Error(
            `Filter for selection '${selectionName}' crashed accessing undefined property '${prop}'.\n\n` +
            `This likely happened because the filter runs during availability checks when ` +
            `previous selections haven't been made yet.\n\n` +
            `Undefined args: ${undefinedList}\n\n` +
            `Fix: Use the dependentFilter helper or add a null check:\n\n` +
            `  // Option 1: Use dependentFilter (recommended)\n` +
            `  import { dependentFilter } from 'boardsmith';\n` +
            `  filter: dependentFilter({\n` +
            `    dependsOn: 'previousSelection',\n` +
            `    whenUndefined: (element) => true, // Allow during availability check\n` +
            `    whenSelected: (element, prev) => /* your filter logic */,\n` +
            `  })\n\n` +
            `  // Option 2: Manual null check\n` +
            `  filter: (element, ctx) => {\n` +
            `    const prev = ctx.args?.previousSelection;\n` +
            `    if (!prev) return true; // Allow during availability check\n` +
            `    return /* your actual filter logic */;\n` +
            `  }`
          );
        }
      }
      // Re-throw if it's a different kind of error
      throw error;
    }
  };
}

// ============================================
// Action Temp State (for choices → execute)
// ============================================

/**
 * Return type for actionTempState helper.
 * Provides methods to get, set, and clear temporary action state.
 */
export interface ActionTempState {
  /**
   * Store a value in temporary state.
   * Values persist between choices() and execute() calls.
   */
  set(key: string, value: unknown): void;

  /**
   * Retrieve a value from temporary state.
   */
  get<T>(key: string): T | undefined;

  /**
   * Clear all temporary state for this action/player.
   * Call this in execute() after you're done with the temp state.
   */
  clear(): void;
}

/**
 * Creates a helper for storing temporary state between choices() and execute().
 *
 * **CRITICAL**: Module-level variables (Maps, arrays, etc.) do NOT persist
 * between choices() and execute() because they run in different contexts.
 * Always use this helper or game.settings for temporary action state.
 *
 * @example
 * ```typescript
 * import { actionTempState } from 'boardsmith';
 *
 * Action.create('armsDealer')
 *   .chooseFrom('equipment', {
 *     choices: (ctx) => {
 *       const temp = actionTempState(ctx, 'armsDealer');
 *       const equipment = ctx.game.equipmentDeck.draw();
 *       temp.set('drawnEquipment', equipment.id);
 *       return [equipment, { value: 'skip', label: 'Skip' }];
 *     },
 *   })
 *   .execute((args, ctx) => {
 *     const temp = actionTempState(ctx, 'armsDealer');
 *     const equipmentId = temp.get<number>('drawnEquipment');
 *     const equipment = ctx.game.getElementById(equipmentId);
 *     temp.clear(); // Clean up
 *     // ... use equipment
 *   });
 * ```
 *
 * @param ctx - The action context (or game and player separately)
 * @param actionName - Unique name for this action's temp state namespace
 */
export function actionTempState(ctx: ActionContext, actionName: string): ActionTempState;
export function actionTempState(game: Game, player: Player, actionName: string): ActionTempState;
export function actionTempState(
  ctxOrGame: ActionContext | Game,
  actionNameOrPlayer: string | Player,
  maybeActionName?: string
): ActionTempState {
  let game: Game;
  let playerPosition: number;
  let actionName: string;

  if (typeof actionNameOrPlayer === 'string') {
    // Called with (ctx, actionName)
    const ctx = ctxOrGame as ActionContext;
    game = ctx.game;
    playerPosition = ctx.player.seat;
    actionName = actionNameOrPlayer;
  } else {
    // Called with (game, player, actionName)
    game = ctxOrGame as Game;
    playerPosition = actionNameOrPlayer.seat;
    actionName = maybeActionName!;
  }

  const prefix = `_actionTemp_${actionName}_${playerPosition}`;

  return {
    set(key: string, value: unknown): void {
      game.settings[`${prefix}_${key}`] = value;
    },

    get<T>(key: string): T | undefined {
      return game.settings[`${prefix}_${key}`] as T | undefined;
    },

    clear(): void {
      const keysToDelete: string[] = [];
      for (const k of Object.keys(game.settings)) {
        if (k.startsWith(prefix)) {
          keysToDelete.push(k);
        }
      }
      for (const k of keysToDelete) {
        delete game.settings[k];
      }
    },
  };
}

/**
 * Options for creating a dependent filter
 */
export interface DependentFilterOptions<T, TPrev> {
  /**
   * The name of the previous selection this filter depends on.
   * During availability checks, this value will be undefined.
   */
  dependsOn: string;

  /**
   * Filter to use when the previous selection is not yet made (availability check).
   * Should return true if this element would be valid for ANY possible previous selection.
   * This determines whether the action shows up as available at all.
   *
   * @param element The element being filtered
   * @param ctx The action context
   * @returns true if this element could be valid for some previous selection
   */
  whenUndefined: (element: T, ctx: ActionContext) => boolean;

  /**
   * Filter to use when the previous selection has been made.
   * Should return true only if this element is valid for the specific previous selection.
   *
   * @param element The element being filtered
   * @param previousValue The selected value from the previous selection
   * @param ctx The action context
   * @returns true if this element is valid for the selected previous value
   */
  whenSelected: (element: T, previousValue: TPrev, ctx: ActionContext) => boolean;
}

/**
 * Creates a filter function that handles the undefined case for multi-step selections.
 *
 * BoardSmith evaluates ALL filters during availability checks, even for selections
 * the player hasn't made yet. This helper makes it easy to handle both cases correctly.
 *
 * @example
 * ```typescript
 * Action.create('move')
 *   .chooseElement('squad', { ... })
 *   .chooseElement('destination', {
 *     filter: dependentFilter({
 *       dependsOn: 'squad',
 *       whenUndefined: (sector, ctx) => {
 *         // Return true if ANY movable squad can reach this sector
 *         return getMovableSquads().some(s => isAdjacent(s.sectorId, sector.id));
 *       },
 *       whenSelected: (sector, squad, ctx) => {
 *         // Return true if the selected squad can reach this sector
 *         return isAdjacent(squad.sectorId, sector.id);
 *       },
 *     }),
 *   })
 * ```
 */
export function dependentFilter<T, TPrev>(
  options: DependentFilterOptions<T, TPrev>
): (element: T, ctx: ActionContext) => boolean {
  return (element: T, ctx: ActionContext) => {
    const previousValue = ctx.args?.[options.dependsOn] as TPrev | undefined;

    if (previousValue === undefined) {
      // Availability check - no selection made yet
      return options.whenUndefined(element, ctx);
    }

    // Actual selection - filter based on selected value
    return options.whenSelected(element, previousValue, ctx);
  };
}

/**
 * Negates a filter function.
 *
 * @example
 * ```typescript
 * filter: not((card, ctx) => card.isUsed)
 * ```
 */
export function not<T>(
  filter: (element: T, ctx: ActionContext) => boolean
): (element: T, ctx: ActionContext) => boolean {
  return (element: T, ctx: ActionContext) => !filter(element, ctx);
}
