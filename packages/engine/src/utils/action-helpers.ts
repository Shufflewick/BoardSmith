import type { Game } from '../element/game.js';
import type { GameElement } from '../element/game-element.js';

/**
 * Resolve an element arg that may be either a numeric ID or an already-resolved element.
 *
 * This is useful in action callbacks when working with followUp args, because:
 * - When you pass `{ sectorId: sector.id }` in a followUp, it's a number
 * - But the server auto-resolves numeric args to elements before calling your callback
 * - So `ctx.args.sectorId` might be the Sector element, not the number
 *
 * This function handles both cases uniformly.
 *
 * @example
 * ```typescript
 * // In your action filter/elements callback:
 * filter: (element, ctx) => {
 *   const sector = resolveElementArg<Sector>(game, ctx.args.sectorId);
 *   if (!sector) return false;
 *   return element.container === sector;
 * }
 * ```
 *
 * @param game The game instance (has getElementById)
 * @param arg The arg value - either a numeric ID or an element
 * @returns The resolved element, or undefined if not found
 */
export function resolveElementArg<T extends GameElement>(
  game: Game,
  arg: unknown
): T | undefined {
  if (arg === undefined || arg === null) {
    return undefined;
  }

  // Already an element object
  if (typeof arg === 'object' && 'id' in arg) {
    return arg as T;
  }

  // Numeric ID - resolve it
  if (typeof arg === 'number') {
    return game.getElementById(arg) as T | undefined;
  }

  return undefined;
}

/**
 * Check if an arg is an element (already resolved) vs a numeric ID.
 * Useful for debugging or conditional logic.
 */
export function isResolvedElement(arg: unknown): arg is GameElement {
  return typeof arg === 'object' && arg !== null && 'id' in arg;
}
