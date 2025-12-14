import { Space } from './space.js';
import { Piece } from './piece.js';
import type { ElementContext, ElementClass } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';

/**
 * Deck - A stack of cards, typically face-down
 *
 * Decks are spaces that:
 * - Contain cards in a stacked order
 * - Usually have hidden contents (draw pile)
 * - Support shuffling
 * - Use "stacking" order (new cards go on top)
 *
 * Examples: draw pile, discard pile, stock pile
 *
 * Usage:
 * ```ts
 * const deck = game.create(Deck, 'draw-pile');
 * deck.setOrder('stacking'); // Cards stack on top
 * deck.contentsHidden(); // No one sees the cards
 * deck.shuffle(); // Randomize order
 *
 * // Draw a card (returns and removes from deck)
 * const card = deck.draw(Card);
 * ```
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
