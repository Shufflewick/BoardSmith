import { Piece } from './piece.js';
import type { ElementContext } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';

/**
 * Card - A two-sided game piece commonly used in card games
 *
 * Cards are pieces that typically have:
 * - Two faces (front and back)
 * - Attributes like rank, suit, value, etc.
 * - Can be face-up or face-down
 *
 * Examples: playing cards, tarot cards, game cards
 *
 * Usage:
 * ```ts
 * class PlayingCard extends Card {
 *   rank!: string; // 'A', '2'-'10', 'J', 'Q', 'K'
 *   suit!: 'hearts' | 'diamonds' | 'clubs' | 'spades';
 * }
 * ```
 */
export class Card<G extends Game = any, P extends Player = any> extends Piece<G, P> {
  /**
   * System property to identify this element type for AutoUI
   * $ prefix indicates this is a system property
   */
  $type!: 'card';

  /** Whether the card is face-up (true) or face-down (false) */
  faceUp: boolean = true;

  constructor(ctx: Partial<ElementContext>) {
    super(ctx);
    // Explicitly set as instance property for serialization
    this.$type = 'card';
  }

  /**
   * Flip the card to show the other face
   */
  flip(): void {
    this.faceUp = !this.faceUp;
  }

  /**
   * Set the card face-up
   */
  showFace(): void {
    this.faceUp = true;
  }

  /**
   * Set the card face-down
   */
  hideFace(): void {
    this.faceUp = false;
  }
}
