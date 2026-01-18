/**
 * useCardDisplay - Utilities for displaying playing cards
 *
 * Provides common functions for rendering playing cards with suit symbols,
 * colors, and rank names. Used by custom game UIs.
 *
 * ## Usage
 *
 * ```typescript
 * import { useCardDisplay, getSuitSymbol, getSuitColor, getRankName } from '@boardsmith/ui';
 *
 * // Use individual functions
 * const symbol = getSuitSymbol('H'); // '♥'
 * const color = getSuitColor('H'); // '#e74c3c' (red)
 * const name = getRankName('K'); // 'King'
 *
 * // Or use the composable
 * const { getSuitSymbol, getSuitColor, getRankName } = useCardDisplay();
 * ```
 *
 * ## In Vue Templates
 *
 * ```vue
 * <script setup>
 * import { getSuitSymbol, getSuitColor } from '@boardsmith/ui';
 * </script>
 *
 * <template>
 *   <div :style="{ color: getSuitColor(card.suit) }">
 *     {{ card.rank }}{{ getSuitSymbol(card.suit) }}
 *   </div>
 * </template>
 * ```
 */

/** Standard suit abbreviations */
export type SuitAbbreviation = 'H' | 'D' | 'C' | 'S';

/** Standard rank abbreviations */
export type RankAbbreviation = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

/** Map of suit abbreviations to Unicode symbols */
const SUIT_SYMBOLS: Record<string, string> = {
  H: '\u2665', // ♥
  D: '\u2666', // ♦
  C: '\u2663', // ♣
  S: '\u2660', // ♠
};

/** Map of suit abbreviations to colors (red for hearts/diamonds, dark for clubs/spades) */
const SUIT_COLORS: Record<string, string> = {
  H: '#e74c3c', // red
  D: '#e74c3c', // red
  C: '#2c3e50', // dark
  S: '#2c3e50', // dark
};

/** Map of rank abbreviations to full names */
const RANK_NAMES: Record<string, string> = {
  A: 'Ace',
  J: 'Jack',
  Q: 'Queen',
  K: 'King',
};

/**
 * Get the Unicode symbol for a suit.
 *
 * @param suit - Suit abbreviation ('H', 'D', 'C', 'S')
 * @returns Unicode suit symbol (♥, ♦, ♣, ♠) or the input if not recognized
 */
export function getSuitSymbol(suit: string): string {
  return SUIT_SYMBOLS[suit] ?? suit;
}

/**
 * Get the color for a suit.
 * Hearts and Diamonds are red, Clubs and Spades are dark.
 *
 * @param suit - Suit abbreviation ('H', 'D', 'C', 'S')
 * @returns CSS color string
 */
export function getSuitColor(suit: string): string {
  return SUIT_COLORS[suit] ?? '#2c3e50';
}

/**
 * Get the full name for a rank.
 * Face cards (A, J, Q, K) are converted to full names.
 * Number cards return the number as-is.
 *
 * @param rank - Rank abbreviation ('A', '2'-'10', 'J', 'Q', 'K')
 * @returns Full rank name ('Ace', 'King', etc.) or the number
 */
export function getRankName(rank: string): string {
  return RANK_NAMES[rank] ?? rank;
}

/**
 * Get the point value for a card (standard playing card values).
 * Ace = 1, Number cards = face value, Face cards (J/Q/K) = 10.
 *
 * @param rank - Rank abbreviation
 * @returns Point value (1-10)
 */
export function getCardPointValue(rank: string): number {
  if (rank === 'A') return 1;
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  return parseInt(rank, 10) || 0;
}

/**
 * Check if a suit is red (Hearts or Diamonds).
 *
 * @param suit - Suit abbreviation
 * @returns true if the suit is red
 */
export function isRedSuit(suit: string): boolean {
  return suit === 'H' || suit === 'D';
}

/**
 * Check if a suit is black (Clubs or Spades).
 *
 * @param suit - Suit abbreviation
 * @returns true if the suit is black
 */
export function isBlackSuit(suit: string): boolean {
  return suit === 'C' || suit === 'S';
}

/**
 * Composable that provides card display utilities.
 * Use this if you prefer the composable pattern.
 */
export function useCardDisplay() {
  return {
    getSuitSymbol,
    getSuitColor,
    getRankName,
    getCardPointValue,
    isRedSuit,
    isBlackSuit,
  };
}
