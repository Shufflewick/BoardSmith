import { Card as BaseCard, Hand as BaseHand, Deck as BaseDeck, Space } from '@boardsmith/engine';

export type Suit = 'H' | 'D' | 'C' | 'S';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export class Card extends BaseCard {
  suit!: Suit;
  rank!: Rank;

  get pointValue(): number {
    const values: Record<Rank, number> = {
      'A': 1, '2': 2, '3': 3, '4': 4, '5': 5,
      '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
      'J': 11, 'Q': 12, 'K': 13,
    };
    return values[this.rank];
  }
}

export class Hand extends BaseHand {
}

export class Deck extends BaseDeck {
}

export class DiscardPile extends Space {
}
