/**
 * Playing-card display helpers used by custom UIs to render a suit symbol,
 * pick a legible colour, and name a rank.
 */
import { describe, it, expect } from 'vitest';
import {
  getSuitSymbol,
  getSuitColor,
  getRankName,
  getCardPointValue,
  isRedSuit,
  isBlackSuit,
  useCardDisplay,
} from './useCardDisplay.js';

const SUITS = ['H', 'D', 'C', 'S'] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

describe('getSuitSymbol', () => {
  it('maps each suit to its Unicode symbol', () => {
    expect(getSuitSymbol('H')).toBe('♥');
    expect(getSuitSymbol('D')).toBe('♦');
    expect(getSuitSymbol('C')).toBe('♣');
    expect(getSuitSymbol('S')).toBe('♠');
  });

  it('gives every standard suit a distinct symbol', () => {
    expect(new Set(SUITS.map(getSuitSymbol)).size).toBe(4);
  });

  it('echoes an unrecognised suit rather than rendering nothing', () => {
    expect(getSuitSymbol('X')).toBe('X');
    expect(getSuitSymbol('')).toBe('');
  });

  it('is case sensitive — a lowercase suit is not a known one', () => {
    expect(getSuitSymbol('h')).toBe('h');
  });
});

describe('getSuitColor', () => {
  it('paints hearts and diamonds red', () => {
    expect(getSuitColor('H')).toBe('#e74c3c');
    expect(getSuitColor('D')).toBe('#e74c3c');
  });

  it('paints clubs and spades dark', () => {
    expect(getSuitColor('C')).toBe('#2c3e50');
    expect(getSuitColor('S')).toBe('#2c3e50');
  });

  it('falls back to the dark colour for an unknown suit, never to nothing', () => {
    expect(getSuitColor('X')).toBe('#2c3e50');
    expect(getSuitColor('')).toBe('#2c3e50');
  });

  it('always returns a usable CSS colour', () => {
    for (const suit of [...SUITS, 'X', '']) {
      expect(getSuitColor(suit)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('agrees with isRedSuit', () => {
    for (const suit of SUITS) {
      expect(getSuitColor(suit) === '#e74c3c').toBe(isRedSuit(suit));
    }
  });
});

describe('getRankName', () => {
  it('names the face cards and the ace', () => {
    expect(getRankName('A')).toBe('Ace');
    expect(getRankName('J')).toBe('Jack');
    expect(getRankName('Q')).toBe('Queen');
    expect(getRankName('K')).toBe('King');
  });

  it('leaves a number rank as its number', () => {
    expect(getRankName('2')).toBe('2');
    expect(getRankName('10')).toBe('10');
  });

  it('echoes an unrecognised rank', () => {
    expect(getRankName('Joker')).toBe('Joker');
  });

  it('returns a non-empty name for every standard rank', () => {
    for (const rank of RANKS) {
      expect(getRankName(rank).length).toBeGreaterThan(0);
    }
  });
});

describe('getCardPointValue', () => {
  it('scores an ace as 1', () => {
    expect(getCardPointValue('A')).toBe(1);
  });

  it('scores each face card as 10', () => {
    expect(getCardPointValue('J')).toBe(10);
    expect(getCardPointValue('Q')).toBe(10);
    expect(getCardPointValue('K')).toBe(10);
  });

  it('scores a number card at face value', () => {
    for (let n = 2; n <= 10; n++) {
      expect(getCardPointValue(String(n))).toBe(n);
    }
  });

  it('scores an unrecognised rank as 0 rather than NaN', () => {
    expect(getCardPointValue('Joker')).toBe(0);
    expect(getCardPointValue('')).toBe(0);
  });

  it('keeps every standard rank in the 1..10 range', () => {
    for (const rank of RANKS) {
      const value = getCardPointValue(rank);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(10);
    }
  });

  it('sums a standard 52-card deck to 340', () => {
    const total = SUITS.length * RANKS.reduce((sum, rank) => sum + getCardPointValue(rank), 0);
    expect(total).toBe(340);
  });
});

describe('isRedSuit / isBlackSuit', () => {
  it('calls hearts and diamonds red', () => {
    expect(isRedSuit('H')).toBe(true);
    expect(isRedSuit('D')).toBe(true);
    expect(isRedSuit('C')).toBe(false);
    expect(isRedSuit('S')).toBe(false);
  });

  it('calls clubs and spades black', () => {
    expect(isBlackSuit('C')).toBe(true);
    expect(isBlackSuit('S')).toBe(true);
    expect(isBlackSuit('H')).toBe(false);
    expect(isBlackSuit('D')).toBe(false);
  });

  it('partitions the four standard suits exactly', () => {
    for (const suit of SUITS) {
      expect(isRedSuit(suit) !== isBlackSuit(suit)).toBe(true);
    }
  });

  it('says no to both for an unknown suit', () => {
    expect(isRedSuit('X')).toBe(false);
    expect(isBlackSuit('X')).toBe(false);
  });
});

describe('useCardDisplay', () => {
  it('exposes the same functions as the module', () => {
    const display = useCardDisplay();
    expect(display.getSuitSymbol).toBe(getSuitSymbol);
    expect(display.getSuitColor).toBe(getSuitColor);
    expect(display.getRankName).toBe(getRankName);
    expect(display.getCardPointValue).toBe(getCardPointValue);
    expect(display.isRedSuit).toBe(isRedSuit);
    expect(display.isBlackSuit).toBe(isBlackSuit);
  });

  it('exposes exactly those six helpers', () => {
    expect(Object.keys(useCardDisplay()).sort()).toEqual([
      'getCardPointValue', 'getRankName', 'getSuitColor', 'getSuitSymbol',
      'isBlackSuit', 'isRedSuit',
    ]);
  });

  it('needs no component instance — it is callable outside setup()', () => {
    expect(() => useCardDisplay()).not.toThrow();
  });

  it('works through the destructured form', () => {
    const { getSuitSymbol: symbol, getCardPointValue: value } = useCardDisplay();
    expect(symbol('S')).toBe('♠');
    expect(value('K')).toBe(10);
  });
});
