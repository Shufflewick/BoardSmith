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
 * const myHand = findPlayerHand(gameView, playerPosition);
 * const cardCount = getElementCount(deck);
 * ```
 */

import type { GameElement, ElementMatchOptions, BaseElementAttributes } from '../types.js';

// Re-export for backwards compatibility
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
 * Find an element in the game view by type, name, or className.
 * Prefers $type and name over className since className can be mangled by bundlers.
 */
export function findElement(
  gameView: GameElement | null | undefined,
  options: ElementMatchOptions
): GameElement | undefined {
  if (!gameView?.children) return undefined;

  const { type, name, className } = options;

  return gameView.children.find((c) => {
    if (type && getAttrs(c).$type === type) return true;
    if (name && c.name === name) return true;
    if (className && c.className === className) return true;
    return false;
  });
}

/**
 * Find multiple elements in the game view matching the criteria.
 */
export function findElements(
  gameView: GameElement | null | undefined,
  options: ElementMatchOptions
): GameElement[] {
  if (!gameView?.children) return [];

  const { type, name, className } = options;

  return gameView.children.filter((c) => {
    if (type && getAttrs(c).$type === type) return true;
    if (name && c.name === name) return true;
    if (className && c.className === className) return true;
    return false;
  });
}

/**
 * Find a player's hand element by position.
 */
export function findPlayerHand(
  gameView: GameElement | null | undefined,
  playerPosition: number
): GameElement | undefined {
  if (!gameView?.children) return undefined;

  return gameView.children.find((c) => {
    const attrs = getAttrs(c);
    return attrs.$type === 'hand' && attrs.player?.position === playerPosition;
  });
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
 * Get the player position that owns an element.
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
  playerPosition: number
): boolean {
  return getElementOwner(element) === playerPosition;
}

/**
 * Check if an element belongs to the specified player (convenience for "my" checks).
 */
export function isMyElement(
  element: GameElement | null | undefined,
  myPlayerPosition: number
): boolean {
  return isOwnedByPlayer(element, myPlayerPosition);
}

/**
 * Check if an element belongs to an opponent (any player that isn't the specified player).
 */
export function isOpponentElement(
  element: GameElement | null | undefined,
  myPlayerPosition: number
): boolean {
  const owner = getElementOwner(element);
  return owner !== undefined && owner !== myPlayerPosition;
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
    findPlayerHand,
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
