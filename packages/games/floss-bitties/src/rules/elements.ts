import { Card as BaseCard, Hand as BaseHand, Deck as BaseDeck, Space, Player } from '@boardsmith/engine';

// 6 suits for Floss Bitties
export type Suit = 'Red' | 'Green' | 'Blue' | 'Purple' | 'Yellow' | 'White';
export const SUITS: Suit[] = ['Red', 'Green', 'Blue', 'Purple', 'Yellow', 'White'];

// Ranks: Wager (0) and 2-10
export type Rank = 'Wager' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10';
export const RANKS: Rank[] = ['Wager', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

// Forward declare for circular reference
import type { FlossBittiesGame } from './game.js';

/**
 * Floss Bitties card with suit and rank
 */
export class Card extends BaseCard<FlossBittiesGame, FlossBittiesPlayer> {
  suit!: Suit;
  rank!: Rank;

  /**
   * Get the numeric value for scoring and ordering
   * Wager = 0, otherwise the numeric rank value
   */
  get value(): number {
    if (this.rank === 'Wager') return 0;
    return parseInt(this.rank, 10);
  }
}

/**
 * A player's hand - visible only to the owner
 */
export class Hand extends BaseHand<FlossBittiesGame, FlossBittiesPlayer> {}

/**
 * The main draw deck - hidden from all players
 */
export class DrawDeck extends BaseDeck<FlossBittiesGame, FlossBittiesPlayer> {}

/**
 * A player's play area for a specific suit
 * Cards must be played in ascending order
 */
export class PlayArea extends Space<FlossBittiesGame, FlossBittiesPlayer> {
  suit!: Suit;
}

/**
 * A shared discard pile for a specific suit
 * Cards are stacked in order played (LIFO)
 */
export class DiscardPile extends Space<FlossBittiesGame, FlossBittiesPlayer> {
  suit!: Suit;
}

/**
 * Floss Bitties player
 */
export class FlossBittiesPlayer extends Player {
  // Score is calculated at game end
}
