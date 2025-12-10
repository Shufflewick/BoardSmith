import { Card as BaseCard, Hand as BaseHand, Deck, Space, Game, Player } from '@boardsmith/engine';

/**
 * Go Fish card with suit and rank
 */
export class Card extends BaseCard<GoFishGame, GoFishPlayer> {
  suit!: 'H' | 'D' | 'C' | 'S';
  rank!: string; // 'A', '2'-'10', 'J', 'Q', 'K'

  /**
   * Get the numeric value for sorting (Ace high)
   */
  get value(): number {
    const values: Record<string, number> = {
      'A': 14, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
      '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13
    };
    return values[this.rank] ?? 0;
  }
}

/**
 * A player's hand - visible only to the owner
 */
export class Hand extends BaseHand<GoFishGame, GoFishPlayer> {}

/**
 * The pond (draw pile) - hidden from all players
 */
export class Pond extends Deck<GoFishGame, GoFishPlayer> {}

/**
 * A player's collection of books (4 of a kind) - visible to all
 */
export class Books extends Space<GoFishGame, GoFishPlayer> {}

/**
 * Go Fish player with reference to their spaces
 */
export class GoFishPlayer extends Player {
  /** Number of completed books */
  bookCount: number = 0;
}

// Forward declare for circular reference
import type { GoFishGame } from './game.js';
