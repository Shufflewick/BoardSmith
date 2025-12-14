import { Space } from './space.js';
import { GameElement, type ElementClass } from './game-element.js';
import type { ElementContext } from './types.js';
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
   * Draw a card from the deck (get and remove the top card)
   *
   * Unlike `first()` which only queries, `draw()` removes the card from the deck.
   * The caller is responsible for placing the card somewhere (hand, discard, etc).
   *
   * @param elementClass - Optional class to filter by (e.g., Card, MercCard)
   * @returns The drawn card, or undefined if deck is empty
   *
   * @example
   * ```ts
   * const card = deck.draw(Card);
   * if (card) {
   *   card.putInto(player.hand);
   * }
   * ```
   */
  draw<T extends GameElement>(elementClass?: ElementClass<T>): T | undefined {
    const card = elementClass ? this.first(elementClass) : this.first() as T | undefined;
    if (card) {
      card.remove();
    }
    return card;
  }
}
