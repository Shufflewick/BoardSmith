/**
 * usePlayerStatAnimation - Utilities for animating elements to player stats in the panel
 *
 * Provides helpers for flying cards/tokens to player stat displays (scores, books, resources, etc.)
 *
 * ## Setup
 *
 * Add data attributes to your player stat elements in the #player-stats slot:
 * ```vue
 * <template #player-stats="{ player }">
 *   <div class="stat">
 *     <span>Score:</span>
 *     <span :data-player-stat="'score'" :data-player-position="player.position">
 *       {{ player.score }}
 *     </span>
 *   </div>
 * </template>
 * ```
 *
 * ## Usage in Custom UI
 *
 * ```typescript
 * import { usePlayerStatAnimation, useFlyingCards } from '@boardsmith/ui';
 *
 * const { flyingCards, flyCards } = useFlyingCards();
 * const { flyToPlayerStat, getPlayerStatElement } = usePlayerStatAnimation();
 *
 * // Fly cards to a player's stat
 * flyToPlayerStat(flyCards, {
 *   cards: removedCards.map(c => ({ rect: c.rect, rank: c.rank, suit: c.suit })),
 *   playerPosition: 0,
 *   statName: 'books',
 * });
 * ```
 */

import type { FlyCardOptions } from './useFlyingCards.js';

export interface CardForAnimation {
  /** Bounding rect of the card's original position */
  rect: DOMRect;
  /** Card rank (optional, for display) */
  rank?: string;
  /** Card suit (optional, for display) */
  suit?: string;
  /** Whether card is face up (default: true) */
  faceUp?: boolean;
  /** Face image URL (optional) */
  faceImage?: string;
  /** Back image URL (optional) */
  backImage?: string;
  /** Player position who owns this card/piece (for piece rendering) */
  playerPosition?: number;
  /** Allow additional custom properties */
  [key: string]: unknown;
}

export interface FlyToStatOptions {
  /** Cards to animate */
  cards: CardForAnimation[];
  /** Player position to target */
  playerPosition: number;
  /** Name of the stat (e.g., 'score', 'books', 'resources') */
  statName: string;
  /** Animation duration in ms (default: 500) */
  duration?: number;
  /** Stagger delay between cards in ms (default: 50) */
  stagger?: number;
  /** Card dimensions (default: { width: 70, height: 100 }) */
  cardSize?: { width: number; height: number };
  /** Whether to flip cards during animation (default: false) */
  flip?: boolean;
}

/**
 * Get a player stat element by position and stat name.
 * Looks for elements with data-player-stat and data-player-position attributes.
 */
export function getPlayerStatElement(
  playerPosition: number,
  statName: string
): HTMLElement | null {
  return document.querySelector(
    `[data-player-stat="${statName}"][data-player-position="${playerPosition}"]`
  );
}

/**
 * Fly cards to a player's stat display in the player panel.
 *
 * @param flyCards - The flyCards function from useFlyingCards
 * @param options - Animation options
 * @returns true if animation was started, false if target not found or no cards
 */
export function flyToPlayerStat(
  flyCards: (options: FlyCardOptions[], staggerMs?: number) => Promise<void>,
  options: FlyToStatOptions
): boolean {
  const {
    cards,
    playerPosition,
    statName,
    duration = 500,
    stagger = 50,
    cardSize = { width: 70, height: 100 },
    flip = false,
  } = options;

  if (cards.length === 0) return false;

  const targetEl = getPlayerStatElement(playerPosition, statName);
  if (!targetEl) {
    console.warn(
      `[usePlayerStatAnimation] Target element not found for player ${playerPosition}, stat "${statName}". ` +
      `Make sure the element has data-player-stat="${statName}" and data-player-position="${playerPosition}".`
    );
    return false;
  }

  flyCards(
    cards.map((card, i) => ({
      id: `fly-stat-${statName}-${playerPosition}-${Date.now()}-${i}`,
      startRect: card.rect,
      endRect: () => targetEl.getBoundingClientRect(),
      cardData: {
        rank: card.rank || '',
        suit: card.suit || '',
        faceUp: card.faceUp ?? true,
        faceImage: card.faceImage,
        backImage: card.backImage,
        // Pass through any extra custom properties (like playerPosition for checkers)
        ...Object.fromEntries(
          Object.entries(card).filter(([k]) => !['rect', 'rank', 'suit', 'faceUp', 'faceImage', 'backImage'].includes(k))
        ),
      },
      flip,
      duration,
      cardSize,
    })),
    stagger
  );

  return true;
}

/**
 * Composable that provides player stat animation utilities.
 */
export function usePlayerStatAnimation() {
  return {
    getPlayerStatElement,
    flyToPlayerStat,
  };
}
