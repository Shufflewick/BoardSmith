import { Piece } from './piece.js';
import type { ElementContext } from './types.js';
import type { Player } from '../player/player.js';
import type { Game } from './game.js';

/**
 * Two-sided game piece with face-up/face-down state.
 *
 * Cards represent any game component with two sides (front and back).
 * Extend this class to create your game's card types with custom attributes.
 *
 * **Key features:**
 * - Face state: Track via `faceUp` property
 * - Flip: Toggle face via `flip()`
 * - Images: Set `$images: { face: '...', back: '...' }` for rendering
 *
 * @example
 * ```typescript
 * // Define a custom card class
 * class PlayingCard extends Card {
 *   rank!: string; // 'A', '2'-'10', 'J', 'Q', 'K'
 *   suit!: 'hearts' | 'diamonds' | 'clubs' | 'spades';
 * }
 *
 * // Create cards in a deck
 * deck.create(PlayingCard, 'Ace of Spades', {
 *   rank: 'A',
 *   suit: 'spades',
 *   $images: { face: 'cards/ace-spades.png', back: 'cards/back.png' }
 * });
 *
 * // Flip a card
 * card.flip();
 * if (card.faceUp) { ... }
 * ```
 *
 * @typeParam G - The Game subclass type
 * @typeParam P - The Player subclass type
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
