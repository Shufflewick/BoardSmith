import { Card as BaseCard, Hand as BaseHand, Deck as BaseDeck, Space, Player } from '@boardsmith/engine';

/**
 * Cribbage card with suit and rank
 * In Cribbage:
 * - Face cards (J, Q, K) = 10 points
 * - Number cards = face value
 * - Ace = 1 point
 */
export class Card extends BaseCard<CribbageGame, CribbagePlayer> {
  suit!: 'H' | 'D' | 'C' | 'S';
  rank!: string; // 'A', '2'-'10', 'J', 'Q', 'K'

  /**
   * Get the point value for counting (pegging/fifteens)
   * A=1, 2-10=face value, J/Q/K=10
   */
  get pointValue(): number {
    if (this.rank === 'A') return 1;
    if (['J', 'Q', 'K'].includes(this.rank)) return 10;
    return parseInt(this.rank, 10);
  }

  /**
   * Get the numeric rank for run detection
   * A=1, 2=2, ..., 10=10, J=11, Q=12, K=13
   */
  get rankValue(): number {
    const values: Record<string, number> = {
      'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
      '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13
    };
    return values[this.rank] ?? 0;
  }

  toString(): string {
    return `${this.rank}${this.suit}`;
  }
}

/**
 * A player's hand - visible only to the owner
 */
export class Hand extends BaseHand<CribbageGame, CribbagePlayer> {}

/**
 * The crib - 4 cards belonging to the dealer, hidden until scoring
 * Extends Deck so AutoUI renders it with card back visualization
 */
export class Crib extends BaseDeck<CribbageGame, CribbagePlayer> {}

/**
 * The deck (draw pile) - hidden from all players
 */
export class Deck extends BaseDeck<CribbageGame, CribbagePlayer> {}

/**
 * The play area - cards played during the play phase
 */
export class PlayArea extends Space<CribbageGame, CribbagePlayer> {}

/**
 * Played cards pile - cards already counted in play phase
 */
export class PlayedCards extends Space<CribbageGame, CribbagePlayer> {}

/**
 * Starter card area - the cut card
 */
export class StarterArea extends Space<CribbageGame, CribbagePlayer> {}

/**
 * Cribbage player with score tracking
 */
export class CribbagePlayer extends Player {
  /** Current score (0-121) */
  score: number = 0;

  /** Whether this player is the dealer this round */
  isDealer: boolean = false;

  /** Cards already played this round (for tracking during play phase) */
  cardsPlayedThisRound: number = 0;

  /** Original hand card IDs (stored after discard, before play phase for scoring) */
  originalHandCardIds: string[] = [];
}

// Forward declare for circular reference
import type { CribbageGame } from './game.js';
