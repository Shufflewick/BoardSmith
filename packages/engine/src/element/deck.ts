import { Space } from './space.js';
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
  }
}
