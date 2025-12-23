import type { GameElement } from '../element/game-element.js';
import type { ActionContext } from './types.js';

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
 *   .chooseElement<Squad>('squad', { ... })
 *   .chooseElement<Sector>('destination', {
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
 * Creates a simple adjacency-based filter for move actions.
 * A common pattern where destination must be adjacent to source.
 *
 * @example
 * ```typescript
 * .chooseElement<Cell>('destination', {
 *   filter: adjacentToSelection({
 *     dependsOn: 'piece',
 *     getPosition: (piece) => piece.cell,
 *     isAdjacent: (cell, pieceCell) => cell.isAdjacentTo(pieceCell),
 *     getAllSources: (ctx) => ctx.player.pieces.filter(p => p.canMove),
 *   }),
 * })
 * ```
 */
export function adjacentToSelection<TDest, TSrc>(options: {
  /** Name of the source selection */
  dependsOn: string;
  /** Get the position/location from the source element */
  getPosition: (source: TSrc) => GameElement | undefined;
  /** Check if destination is adjacent to source position */
  isAdjacent: (destination: TDest, sourcePosition: GameElement) => boolean;
  /** Get all possible sources (for availability check) */
  getAllSources: (ctx: ActionContext) => TSrc[];
}): (element: TDest, ctx: ActionContext) => boolean {
  return dependentFilter<TDest, TSrc>({
    dependsOn: options.dependsOn,
    whenUndefined: (dest, ctx) => {
      // Check if any source can reach this destination
      const sources = options.getAllSources(ctx);
      return sources.some(src => {
        const pos = options.getPosition(src);
        return pos && options.isAdjacent(dest, pos);
      });
    },
    whenSelected: (dest, src, ctx) => {
      const pos = options.getPosition(src);
      return pos ? options.isAdjacent(dest, pos) : false;
    },
  });
}

/**
 * Creates a filter that excludes elements already selected in a previous multi-select.
 * Useful for "select multiple unique items" patterns.
 *
 * @example
 * ```typescript
 * .chooseElement<Card>('cards', {
 *   repeat: { max: 3 },
 *   filter: excludeAlreadySelected('cards'),
 * })
 * ```
 */
export function excludeAlreadySelected<T extends GameElement>(
  selectionName: string
): (element: T, ctx: ActionContext) => boolean {
  return (element: T, ctx: ActionContext) => {
    const selected = ctx.args?.[selectionName] as T[] | undefined;
    if (!selected || selected.length === 0) {
      return true;
    }
    // Use ID comparison to handle object reference issues
    return !selected.some(s => s.id === element.id);
  };
}

/**
 * Combines multiple filter functions with AND logic.
 * All filters must return true for the element to be valid.
 *
 * @example
 * ```typescript
 * filter: allOf(
 *   (card, ctx) => card.suit === 'hearts',
 *   (card, ctx) => card.rank >= 10,
 *   excludeAlreadySelected('cards'),
 * )
 * ```
 */
export function allOf<T>(
  ...filters: Array<(element: T, ctx: ActionContext) => boolean>
): (element: T, ctx: ActionContext) => boolean {
  return (element: T, ctx: ActionContext) => {
    return filters.every(f => f(element, ctx));
  };
}

/**
 * Combines multiple filter functions with OR logic.
 * At least one filter must return true for the element to be valid.
 *
 * @example
 * ```typescript
 * filter: anyOf(
 *   (card, ctx) => card.suit === 'hearts',
 *   (card, ctx) => card.suit === 'diamonds',
 * )
 * ```
 */
export function anyOf<T>(
  ...filters: Array<(element: T, ctx: ActionContext) => boolean>
): (element: T, ctx: ActionContext) => boolean {
  return (element: T, ctx: ActionContext) => {
    return filters.some(f => f(element, ctx));
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
