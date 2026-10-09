/**
 * useGameViewHelpers - Utilities for working with game view data in custom UIs
 *
 * Provides helper functions for finding elements in the game view tree,
 * handling the className mangling issue that can occur with bundlers.
 *
 * Usage:
 * ```typescript
 * import { findElement, findPlayerHand, getElementCount } from 'boardsmith/ui';
 *
 * const deck = findElement(gameView, { type: 'deck' });
 * const myHand = findPlayerHand(gameView, playerSeat);
 * const cardCount = getElementCount(deck);
 * ```
 */

import type { GameViewElement, ElementMatchOptions, BaseElementAttributes } from '../types.js';

export type { ElementMatchOptions as FindElementOptions };

/** Helper to get typed attributes from an element */
function getAttrs(element: GameViewElement): BaseElementAttributes & Record<string, unknown> {
  return (element.attributes ?? {}) as BaseElementAttributes & Record<string, unknown>;
}

/**
 * Whether an element satisfies every criterion given (AND). Criteria left
 * undefined are not checked; an options object with no criteria matches nothing.
 */
function matches(element: GameViewElement, options: ElementMatchOptions): boolean {
  const { id, type, name, className } = options;
  if (id === undefined && type === undefined && name === undefined && className === undefined) {
    return false;
  }
  if (id !== undefined && element.id !== id) return false;
  if (type !== undefined && getAttrs(element).$type !== type) return false;
  if (name !== undefined && element.name !== name) return false;
  if (className !== undefined && element.className !== className) return false;
  return true;
}

/**
 * Find the first element anywhere in the game view tree (depth-first) that
 * satisfies every criterion in `options`: `id`, `type` (the `$type` attribute),
 * `name` and `className`. Prefer `id`, `type` and `name` over `className`,
 * which bundlers can mangle. With no criteria nothing matches.
 */
export function findElement(
  gameView: GameViewElement | null | undefined,
  options: ElementMatchOptions
): GameViewElement | undefined {
  if (!gameView) return undefined;
  if (matches(gameView, options)) return gameView;

  for (const child of gameView.children ?? []) {
    const found = findElement(child, options);
    if (found) return found;
  }
  return undefined;
}

/**
 * Find every element anywhere in the game view tree (depth-first) that
 * satisfies every criterion in `options`. See `findElement`.
 */
export function findElements(
  gameView: GameViewElement | null | undefined,
  options: ElementMatchOptions
): GameViewElement[] {
  const results: GameViewElement[] = [];

  function search(element: GameViewElement | null | undefined): void {
    if (!element) return;
    if (matches(element, options)) results.push(element);
    for (const child of element.children ?? []) search(child);
  }

  search(gameView);
  return results;
}

/**
 * Find a player's hand anywhere in the game view tree: the first element with
 * `$type` 'hand' owned by that seat.
 */
export function findPlayerHand(
  gameView: GameViewElement | null | undefined,
  playerSeat: number
): GameViewElement | undefined {
  return findElements(gameView, { type: 'hand' }).find(
    (hand) => getAttrs(hand).player?.seat === playerSeat
  );
}

/**
 * Find a Player element anywhere in the game view tree by position.
 * Performs a recursive depth-first search.
 *
 * IMPORTANT: This returns the Player element from the element tree, which contains
 * all custom attributes. This is different from gameView.players which is a
 * simplified array for display purposes.
 *
 * Use this when you need to access custom player properties like:
 * - Custom attributes defined on your Player subclass
 * - Player state that changes during the game
 *
 * @example
 * ```typescript
 * // Find player element by seat
 * const playerElement = findPlayerElement(gameView, playerSeat);
 *
 * // Access custom attributes
 * const diceWager = playerElement?.attributes?.diceWager ?? 1;
 * const specialAbility = playerElement?.attributes?.ability;
 * ```
 */
export function findPlayerElement(
  gameView: GameViewElement | null | undefined,
  playerSeat: number
): GameViewElement | undefined {
  function search(element: GameViewElement | null | undefined): GameViewElement | undefined {
    if (!element) return undefined;

    // Check if this is a Player element with matching seat
    const attrs = getAttrs(element);
    if (attrs.$type === 'player' && attrs.seat === playerSeat) {
      return element;
    }

    // Recursively search children
    if (element.children) {
      for (const child of element.children) {
        const found = search(child);
        if (found) return found;
      }
    }

    return undefined;
  }

  return search(gameView);
}

/**
 * Get a custom attribute from a player in the element tree.
 * Convenience function that combines findPlayerElement with attribute access.
 *
 * @example
 * ```typescript
 * // Get a custom player attribute with a default value
 * const diceWager = getPlayerAttribute(gameView, playerSeat, 'diceWager', 1);
 * const score = getPlayerAttribute(gameView, playerSeat, 'score', 0);
 * ```
 */
export function getPlayerAttribute<T>(
  gameView: GameViewElement | null | undefined,
  playerSeat: number,
  attributeName: string,
  defaultValue: T
): T {
  const playerElement = findPlayerElement(gameView, playerSeat);
  if (!playerElement) return defaultValue;

  const attrs = getAttrs(playerElement);
  const value = attrs[attributeName];
  return value !== undefined ? (value as T) : defaultValue;
}

/**
 * Find all hand elements in the game view.
 */
export function findAllHands(
  gameView: GameViewElement | null | undefined
): GameViewElement[] {
  if (!gameView?.children) return [];

  return gameView.children.filter((c) => getAttrs(c).$type === 'hand');
}

/**
 * Get the count of children in an element, handling hidden contents.
 * For elements with hidden contents (like decks), this returns childCount.
 */
export function getElementCount(element: GameViewElement | null | undefined): number {
  if (!element) return 0;

  // If there are visible children, count them
  if (element.children && element.children.length > 0) {
    return element.children.length;
  }

  // Otherwise use childCount for hidden contents
  return element.childCount || 0;
}

/**
 * Get cards from an element (filters to elements with rank attribute).
 */
export function getCards(element: GameViewElement | null | undefined): GameViewElement[] {
  if (!element?.children) return [];

  return element.children.filter((c) => getAttrs(c).rank !== undefined);
}

/**
 * Get the first card from an element.
 */
export function getFirstCard(element: GameViewElement | null | undefined): GameViewElement | undefined {
  return getCards(element)[0];
}

/**
 * Get the player seat that owns an element.
 * Returns undefined if the element has no player owner.
 */
export function getElementOwner(element: GameViewElement | null | undefined): number | undefined {
  if (!element) return undefined;
  return getAttrs(element).player?.seat;
}

/**
 * Check if an element belongs to a specific player.
 */
export function isOwnedByPlayer(
  element: GameViewElement | null | undefined,
  playerSeat: number
): boolean {
  return getElementOwner(element) === playerSeat;
}

/**
 * Check if an element belongs to the specified player (convenience for "my" checks).
 */
export function isMyElement(
  element: GameViewElement | null | undefined,
  myPlayerSeat: number
): boolean {
  return isOwnedByPlayer(element, myPlayerSeat);
}

/**
 * Check if an element belongs to an opponent (any player that isn't the specified player).
 */
export function isOpponentElement(
  element: GameViewElement | null | undefined,
  myPlayerSeat: number
): boolean {
  const owner = getElementOwner(element);
  return owner !== undefined && owner !== myPlayerSeat;
}

/**
 * Get the numeric element ID from an element.
 * This is the ID needed for all action API calls (execute, fill, etc.).
 *
 * @example
 * ```typescript
 * const equipment = findElement(gameView, { name: selectedName });
 * const equipmentId = getElementId(equipment);  // number | undefined
 * if (equipmentId) {
 *   await actionController.execute('dropEquipment', { equipment: equipmentId });
 * }
 * ```
 */
export function getElementId(element: GameViewElement | null | undefined): number | undefined {
  return element?.id;
}
