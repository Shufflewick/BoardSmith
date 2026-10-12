import type { Game } from '../element/game.js';
import type { Player } from '../player/player.js';
import type { ActionContext } from './types.js';
import { stateChanged } from '../element/state-version.js';

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
// Action Temp State (carried from one step to a later one)
// ============================================

/**
 * Return type for actionTempState helper.
 * Provides methods to get, set, and clear temporary action state.
 */
export interface ActionTempState {
  /**
   * Store a value in temporary state.
   * Values stay in game state until `clear()`.
   */
  set(key: string, value: unknown): void;

  /**
   * Retrieve a value from temporary state.
   */
  get<T>(key: string): T | undefined;

  /**
   * Clear all temporary state for this name and player.
   * Call this once the value has been used.
   */
  clear(): void;
}

/**
 * Creates a helper for keeping a value that is not an element in game state,
 * so a later step can read it, such as from one action's `execute` to a later
 * action.
 *
 * **CRITICAL**: Module-level variables (Maps, arrays, etc.) do NOT carry a
 * value between actions, because they may run in different contexts.
 * Always use this helper for temporary action state.
 *
 * Write it only from an action's `execute` or a flow step. Never write it
 * from a candidate callback (`choices`, `elements`, `from`, `filter`): those
 * run on every question about a pick, so the write happens again each time
 * (#674).
 *
 * @example
 * ```typescript
 * import { actionTempState } from 'boardsmith';
 *
 * Action.create('explore')
 *   .chooseElement('sector', { elementClass: Sector })
 *   .execute((args, ctx) => {
 *     actionTempState(ctx, 'explore').set('sectorId', args.sector.id);
 *   });
 *
 * Action.create('collectLoot')
 *   .chooseElement('loot', {
 *     elements: (ctx) => {
 *       const sectorId = actionTempState(ctx, 'explore').get<number>('sectorId');
 *       if (sectorId === undefined) return [];
 *       return ctx.game.getElementById(sectorId)!.all(Equipment);
 *     },
 *   })
 *   .execute((args, ctx) => {
 *     args.loot.putInto(ctx.player.stash);
 *     actionTempState(ctx, 'explore').clear(); // Clean up
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
      stateChanged(game._ctx);
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
      stateChanged(game._ctx);
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
 * A filter is handed `ctx.args` as they stand, so it can be called before the
 * selection it narrows by has been answered: when the engine walks a DECLARED
 * dependency (`dependsOn` / `filterBy`), and when a persistent world enumerates
 * every selection of an offer in one frame. This helper makes both cases
 * explicit instead of leaving a callback to dereference `undefined`.
 *
 * It is NOT needed to keep an action on the panel. Since #270 an action is
 * offered on its FIRST unsatisfied step, so a later step that answers nothing
 * while its input is missing no longer removes the verb -- `whenUndefined` may
 * return `false` for everything if that is the truth, rather than over-offering
 * the union of every earlier answer's rows.
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
