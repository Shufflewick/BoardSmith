/**
 * useGameViewHelpers - Utilities for working with game view data in custom UIs
 *
 * Provides helper functions for finding elements in the game view tree,
 * handling the className mangling issue that can occur with bundlers.
 *
 * Usage:
 * ```typescript
 * const { findElement, findPlayerHand, getElementCount } = useGameViewHelpers();
 *
 * const deck = findElement(gameView, { type: 'deck' });
 * const myHand = findPlayerHand(gameView, playerSeat);
 * const cardCount = getElementCount(deck);
 * ```
 */

import type { GameElement, ElementMatchOptions, BaseElementAttributes } from '../types.js';

// Re-export types
export type { GameElement };
export type { ElementMatchOptions as FindElementOptions };

/** Helper to get typed attributes from an element */
function getAttrs(element: GameElement): BaseElementAttributes & Record<string, unknown> {
  return (element.attributes ?? {}) as BaseElementAttributes & Record<string, unknown>;
}

/**
 * Find an element anywhere in the game view tree by its numeric ID.
 * Performs a recursive depth-first search.
 */
export function findElementById(
  gameView: GameElement | null | undefined,
  id: number
): GameElement | undefined {
  if (!gameView) return undefined;

  // Check if this element matches
  if (gameView.id === id) return gameView;

  // Recursively search children
  if (gameView.children) {
    for (const child of gameView.children) {
      const found = findElementById(child, id);
      if (found) return found;
    }
  }

  return undefined;
}

/**
 * Find an element anywhere in the game view tree by type, name, or className.
 * Performs a recursive depth-first search.
 * Prefers $type and name over className since className can be mangled by bundlers.
 */
export function findElement(
  gameView: GameElement | null | undefined,
  options: ElementMatchOptions
): GameElement | undefined {
  if (!gameView) return undefined;

  const { type, name, className } = options;

  // Check if this element matches
  const attrs = getAttrs(gameView);
  if (type && attrs.$type === type) return gameView;
  if (name && gameView.name === name) return gameView;
  if (className && gameView.className === className) return gameView;

  // Recursively search children
  if (gameView.children) {
    for (const child of gameView.children) {
      const found = findElement(child, options);
      if (found) return found;
    }
  }

  return undefined;
}

/**
 * Find all elements anywhere in the game view tree matching the criteria.
 * Performs a recursive depth-first search.
 */
export function findElements(
  gameView: GameElement | null | undefined,
  options: ElementMatchOptions
): GameElement[] {
  const results: GameElement[] = [];

  function search(element: GameElement | null | undefined): void {
    if (!element) return;

    const { type, name, className } = options;
    const attrs = getAttrs(element);

    // Check if this element matches
    if (type && attrs.$type === type) results.push(element);
    else if (name && element.name === name) results.push(element);
    else if (className && element.className === className) results.push(element);

    // Recursively search children
    if (element.children) {
      for (const child of element.children) {
        search(child);
      }
    }
  }

  search(gameView);
  return results;
}

/**
 * Find a player's hand element by seat.
 */
export function findPlayerHand(
  gameView: GameElement | null | undefined,
  playerSeat: number
): GameElement | undefined {
  if (!gameView?.children) return undefined;

  return gameView.children.find((c) => {
    const attrs = getAttrs(c);
    return attrs.$type === 'hand' && attrs.player?.position === playerSeat;
  });
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
  gameView: GameElement | null | undefined,
  playerSeat: number
): GameElement | undefined {
  function search(element: GameElement | null | undefined): GameElement | undefined {
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
  gameView: GameElement | null | undefined,
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
  gameView: GameElement | null | undefined
): GameElement[] {
  if (!gameView?.children) return [];

  return gameView.children.filter((c) => getAttrs(c).$type === 'hand');
}

/**
 * Get the count of children in an element, handling hidden contents.
 * For elements with hidden contents (like decks), this returns childCount.
 */
export function getElementCount(element: GameElement | null | undefined): number {
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
export function getCards(element: GameElement | null | undefined): GameElement[] {
  if (!element?.children) return [];

  return element.children.filter((c) => getAttrs(c).rank !== undefined);
}

/**
 * Get the first card from an element.
 */
export function getFirstCard(element: GameElement | null | undefined): GameElement | undefined {
  return getCards(element)[0];
}

/**
 * Extract card data (rank, suit) from a game element.
 * Returns undefined if the element has no rank attribute.
 */
export function getCardData(element: GameElement | null | undefined): { rank: string; suit: string } | undefined {
  if (!element) return undefined;

  const attrs = getAttrs(element);
  if (attrs.rank === undefined) return undefined;

  return {
    rank: attrs.rank,
    suit: attrs.suit ?? '',
  };
}

/**
 * Get the player seat that owns an element.
 * Returns undefined if the element has no player owner.
 */
export function getElementOwner(element: GameElement | null | undefined): number | undefined {
  if (!element) return undefined;
  return getAttrs(element).player?.position;
}

/**
 * Check if an element belongs to a specific player.
 */
export function isOwnedByPlayer(
  element: GameElement | null | undefined,
  playerSeat: number
): boolean {
  return getElementOwner(element) === playerSeat;
}

/**
 * Check if an element belongs to the specified player (convenience for "my" checks).
 */
export function isMyElement(
  element: GameElement | null | undefined,
  myPlayerSeat: number
): boolean {
  return isOwnedByPlayer(element, myPlayerSeat);
}

/**
 * Check if an element belongs to an opponent (any player that isn't the specified player).
 */
export function isOpponentElement(
  element: GameElement | null | undefined,
  myPlayerSeat: number
): boolean {
  const owner = getElementOwner(element);
  return owner !== undefined && owner !== myPlayerSeat;
}

/**
 * Find a child element by matching an attribute value.
 * Searches only direct children of the element.
 *
 * This is useful when you have element data (like equipment stats) but need the
 * element's numeric ID for API calls.
 *
 * @example
 * ```typescript
 * // Find equipment by name
 * const weapon = findChildByAttribute(merc, 'equipmentName', 'Laser Rifle');
 * if (weapon) {
 *   await actionController.execute('dropEquipment', { equipment: weapon.id });
 * }
 * ```
 */
export function findChildByAttribute(
  parent: GameElement | null | undefined,
  attributeName: string,
  attributeValue: unknown
): GameElement | undefined {
  if (!parent?.children) return undefined;

  return parent.children.find((child) => {
    const attrs = getAttrs(child);
    return attrs[attributeName] === attributeValue;
  });
}

/**
 * Find an element anywhere in the tree by matching an attribute value.
 * Performs a recursive depth-first search.
 *
 * @example
 * ```typescript
 * // Find any element with a specific unique attribute
 * const sector = findElementByAttribute(gameView, 'sectorId', 'alpha-3');
 * ```
 */
export function findElementByAttribute(
  root: GameElement | null | undefined,
  attributeName: string,
  attributeValue: unknown
): GameElement | undefined {
  if (!root) return undefined;

  // Check this element
  const attrs = getAttrs(root);
  if (attrs[attributeName] === attributeValue) return root;

  // Recursively search children
  if (root.children) {
    for (const child of root.children) {
      const found = findElementByAttribute(child, attributeName, attributeValue);
      if (found) return found;
    }
  }

  return undefined;
}

/**
 * Find all elements in the tree matching an attribute value.
 * Performs a recursive depth-first search.
 */
export function findAllByAttribute(
  root: GameElement | null | undefined,
  attributeName: string,
  attributeValue: unknown
): GameElement[] {
  const results: GameElement[] = [];

  function search(element: GameElement | null | undefined): void {
    if (!element) return;

    const attrs = getAttrs(element);
    if (attrs[attributeName] === attributeValue) {
      results.push(element);
    }

    if (element.children) {
      for (const child of element.children) {
        search(child);
      }
    }
  }

  search(root);
  return results;
}

/**
 * Get the numeric element ID from an element.
 * This is the ID needed for all action API calls (execute, fill, etc.).
 *
 * @example
 * ```typescript
 * const equipment = findChildByAttribute(merc, 'equipmentName', selectedName);
 * const equipmentId = getElementId(equipment);  // number | undefined
 * if (equipmentId) {
 *   await actionController.execute('dropEquipment', { equipment: equipmentId });
 * }
 * ```
 */
export function getElementId(element: GameElement | null | undefined): number | undefined {
  return element?.id;
}

/**
 * Composable that returns all helper functions.
 * Can be used in Vue components for convenience.
 */
export function useGameViewHelpers() {
  return {
    findElementById,
    findElement,
    findElements,
    findChildByAttribute,
    findElementByAttribute,
    findAllByAttribute,
    getElementId,
    findPlayerHand,
    findPlayerElement,
    getPlayerAttribute,
    findAllHands,
    getElementCount,
    getCards,
    getFirstCard,
    getCardData,
    getElementOwner,
    isOwnedByPlayer,
    isMyElement,
    isOpponentElement,
  };
}
