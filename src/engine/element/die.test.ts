/**
 * Die — a die without a whole number of sides must refuse to roll or be set,
 * instead of producing NaN (#765).
 */
import { describe, it, expect } from 'vitest';
import { Die, Game, Player, type GameOptions } from '../index.js';

class BareGame extends Game<BareGame, Player> {
  constructor(options: GameOptions) {
    super(options);
  }
}

const newGame = () => new BareGame({ playerCount: 2, seed: 'die-seed' });

describe('Die sides', () => {
  const badSides: Array<[string, Record<string, unknown>]> = [
    ['missing', {}],
    ['0', { sides: 0 }],
    ['2.5', { sides: 2.5 }],
    ['NaN', { sides: NaN }],
  ];

  for (const [label, attrs] of badSides) {
    it(`refuses roll and setValue when sides is ${label}`, () => {
      const die = newGame().create(Die, 'broken', attrs);
      const message = /Die "broken" needs sides set to a whole number of at least 1/;
      expect(() => die.roll()).toThrow(message);
      expect(() => die.setValue(1)).toThrow(message);
      expect(die.rollCount).toBe(0);
    });
  }

  it('still rolls and sets a normal d6 within 1 to sides', () => {
    const die = newGame().create(Die, 'd6', { sides: 6 });
    const rolled = die.roll();
    expect(Number.isInteger(rolled)).toBe(true);
    expect(rolled).toBeGreaterThanOrEqual(1);
    expect(rolled).toBeLessThanOrEqual(6);
    die.setValue(6);
    expect(die.value).toBe(6);
  });

  it('refuses setValue outside 1 to sides or not a whole number', () => {
    const die = newGame().create(Die, 'd6', { sides: 6 });
    for (const n of [0, 7, 2.5, NaN]) {
      expect(() => die.setValue(n)).toThrow(/Invalid die value/);
    }
  });
});
