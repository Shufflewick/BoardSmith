/**
 * Demo Animation - Elements
 *
 * Defines the game elements used to demonstrate various animations.
 * Uses generic zones instead of game-specific elements like Deck/Hand.
 */

import { Card as BaseCard, Space } from '@boardsmith/engine';

export type Suit = 'H' | 'D' | 'C' | 'S';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

/**
 * Card element with rank, suit, and face-up state
 */
export class Card extends BaseCard {
  suit!: Suit;
  rank!: Rank;
  faceUp: boolean = true;

  get pointValue(): number {
    const values: Record<Rank, number> = {
      'A': 1, '2': 2, '3': 3, '4': 4, '5': 5,
      '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
      'J': 11, 'Q': 12, 'K': 13,
    };
    return values[this.rank];
  }
}

/**
 * Generic zone for holding cards.
 * Used to demonstrate animation features without game-specific semantics.
 */
export class Zone extends Space {
  /** Whether cards in this zone are displayed face-up */
  faceUp: boolean = true;
}
