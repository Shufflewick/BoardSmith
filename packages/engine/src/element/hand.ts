import { Space } from './space.js';
import type { ElementContext } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';

/**
 * Player's hand of cards with fanned display layout.
 *
 * Hand is a specialized Space for cards held by a player, with:
 * - Default fanned layout for visual presentation
 * - Typically owner-only visibility
 *
 * @example
 * ```typescript
 * // Create hands for each player
 * for (const player of game.players) {
 *   const hand = game.create(Hand, `hand-${player.position}`, {
 *     player
 *   });
 *   hand.contentsVisibleToOwner(); // Only owner sees their cards
 * }
 *
 * // Deal cards
 * deck.drawTo(player.hand, 7);
 *
 * // Query cards in hand
 * const playableCards = player.hand.all(Card, c => c.cost <= player.mana);
 * ```
 *
 * @typeParam G - The Game subclass type
 * @typeParam P - The Player subclass type
 */
export class Hand<G extends Game = any, P extends Player = any> extends Space<G, P> {
  /**
   * System property to identify this element type for AutoUI
   * $ prefix indicates this is a system property
   */
  $type!: 'hand';

  constructor(ctx: Partial<ElementContext>) {
    super(ctx);
    // Explicitly set as instance property for serialization
    this.$type = 'hand';

    // Default layout: horizontal fan with overlap
    this.$direction = 'horizontal';
    this.$fan = true;
    this.$fanAngle = 30;
    this.$overlap = 0.5;
    this.$align = 'center';
  }
}
