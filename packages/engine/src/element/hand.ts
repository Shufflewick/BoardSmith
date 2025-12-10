import { Space } from './space.js';
import type { ElementContext } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';

/**
 * Hand - A collection of cards held by a player
 *
 * Hands are spaces that:
 * - Are owned by a specific player
 * - Typically contain cards
 * - Have visibility rules (usually visible only to owner)
 * - Often displayed in a fan or row
 *
 * Examples: player's hand in card games, tiles in tile-based games
 *
 * Usage:
 * ```ts
 * const hand = game.create(Hand, `hand-${player.position}`);
 * hand.player = player;
 * hand.contentsVisibleToOwner(); // Only owner sees cards
 * ```
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
