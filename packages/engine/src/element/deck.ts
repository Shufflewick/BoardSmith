import { Space } from './space.js';
import { Piece } from './piece.js';
import type { ElementContext, ElementClass } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';

/**
 * Stacked container for cards, typically a draw pile.
 *
 * Deck is a specialized Space with:
 * - Stacking order (new cards go on top by default)
 * - Visual layout for overlapping cards
 * - Convenience method for drawing cards
 *
 * @example
 * ```typescript
 * // Create and populate a deck
 * const deck = game.create(Deck, 'draw-pile');
 * for (const cardData of CARDS) {
 *   deck.create(Card, cardData.name, cardData);
 * }
 * deck.shuffle();
 * deck.contentsHidden(); // Hide contents from all players
 *
 * // Draw cards to a player's hand
 * deck.drawTo(player.hand, 5);
 *
 * // Check if deck is empty
 * if (deck.isEmpty()) {
 *   // Reshuffle discard pile...
 * }
 * ```
 *
 * @typeParam G - The Game subclass type
 * @typeParam P - The Player subclass type
 */
export class Deck<G extends Game = any, P extends Player = any> extends Space<G, P> {
  /**
   * System property to identify this element type for AutoUI
   * $ prefix indicates this is a system property
   */
  $type!: 'deck';

  constructor(ctx: Partial<ElementContext>) {
    super(ctx);
    // Explicitly set as instance property for serialization
    this.$type = 'deck';

    // Decks default to stacking order (new items go on top)
    this.setOrder('stacking');

    // Default layout: stacked with heavy overlap (deck appearance)
    this.$direction = 'vertical';
    this.$overlap = 0.95;
    this.$align = 'center';
  }

  /**
   * Draw cards from the deck directly to a destination
   *
   * This is a convenience method that combines `first()` + `putInto()` for the
   * common pattern of drawing cards to a player's hand or another space.
   *
   * @param destination - Where to put the drawn cards
   * @param count - Number of cards to draw (default: 1)
   * @param elementClass - Optional class to filter by (default: Piece)
   * @returns Array of drawn cards (may be fewer than count if deck runs out)
   *
   * @example
   * ```ts
   * // Draw 1 card to hand
   * deck.drawTo(player.hand);
   *
   * // Draw 5 cards to hand
   * deck.drawTo(player.hand, 5);
   *
   * // Draw 5 cards with type safety
   * const cards = deck.drawTo(player.hand, 5, Card);
   *
   * // Deal to multiple players
   * for (const player of game.players) {
   *   deck.drawTo(player.hand, 7);
   * }
   * ```
   */
  drawTo<T extends Piece>(
    destination: Space<G, P>,
    count: number = 1,
    elementClass?: ElementClass<T>
  ): T[] {
    const drawn: T[] = [];
    const cls = elementClass ?? (Piece as unknown as ElementClass<T>);

    for (let i = 0; i < count; i++) {
      const card = this.first(cls);
      if (!card) break; // Deck is empty
      card.putInto(destination);
      drawn.push(card);
    }

    return drawn;
  }
}
