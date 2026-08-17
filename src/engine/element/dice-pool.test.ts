/**
 * DicePool — the dice-tray container games roll from. Every roll consumes the
 * game's seeded RNG, so these tests also pin that a pool is reproducible from
 * a seed, which is what makes a dice game replayable.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DicePool, Die, Game, Player, Space, type GameOptions } from '../index.js';

class DiceGame extends Game<DiceGame, Player> {
  pool!: DicePool<DiceGame>;

  constructor(options: GameOptions) {
    super(options);
    this.pool = this.create(DicePool, 'tray');
    this.pool.create(Die, 'first', { sides: 6 });
    this.pool.create(Die, 'second', { sides: 6 });
    this.pool.create(Die, 'big', { sides: 20 });
  }
}

const newGame = (seed = 'dice-seed') => new DiceGame({ playerCount: 2, seed });

describe('DicePool', () => {
  let game: DiceGame;
  let pool: DicePool<DiceGame>;

  beforeEach(() => {
    game = newGame();
    pool = game.pool;
  });

  it('is a Space, so dice live in it like any other zone', () => {
    expect(pool).toBeInstanceOf(Space);
  });

  it('identifies itself to the auto-UI as a dice pool', () => {
    expect(pool.$type).toBe('dice-pool');
  });

  it('lays its dice out in a row by default', () => {
    expect(pool.$direction).toBe('horizontal');
    expect(pool.$align).toBe('center');
    expect(pool.$gap).toBe('12px');
  });

  it('serializes its type and layout for the client', () => {
    expect(pool.toJSON().attributes).toMatchObject({
      $type: 'dice-pool',
      $direction: 'horizontal',
    });
  });

  describe('querying', () => {
    it('reports every die it holds', () => {
      expect(pool.getDice()).toHaveLength(3);
    });

    it('reports an empty pool as holding nothing', () => {
      const empty = game.create(DicePool, 'empty');
      expect(empty.getDice()).toHaveLength(0);
      expect(empty.getValues()).toEqual([]);
      expect(empty.getTotal()).toBe(0);
    });

    it('filters dice by their number of sides', () => {
      expect(pool.getDiceByType(6).map((d) => d.name)).toEqual(['first', 'second']);
      expect(pool.getDiceByType(20).map((d) => d.name)).toEqual(['big']);
    });

    it('returns nothing for a die type the pool does not hold', () => {
      expect(pool.getDiceByType(12)).toEqual([]);
    });

    it('ignores non-dice children', () => {
      pool.create(Space, 'label');
      expect(pool.getDice()).toHaveLength(3);
    });
  });

  describe('rolling', () => {
    it('rolls every die and reports each result', () => {
      const results = pool.rollAll();
      expect(results).toHaveLength(3);
      for (const [die, value] of results) {
        expect(die.value).toBe(value);
      }
    });

    it('keeps every rolled value within that die range', () => {
      for (let i = 0; i < 50; i++) {
        for (const [die, value] of pool.rollAll()) {
          expect(value).toBeGreaterThanOrEqual(1);
          expect(value).toBeLessThanOrEqual(die.sides);
        }
      }
    });

    it('rolls only the named dice', () => {
      pool.rollAll();
      const before = pool.getValues();
      const results = pool.rollByName('big');
      expect(results.map(([die]) => die.name)).toEqual(['big']);
      expect(pool.getValues().slice(0, 2)).toEqual(before.slice(0, 2));
    });

    it('rolls several named dice in the order given', () => {
      expect(pool.rollByName('second', 'first').map(([die]) => die.name))
        .toEqual(['second', 'first']);
    });

    it('silently skips a name that matches no die', () => {
      expect(pool.rollByName('nonexistent')).toEqual([]);
      expect(pool.rollByName('first', 'nonexistent')).toHaveLength(1);
    });

    it('rolls only the dice of a given type', () => {
      expect(pool.rollByType(6).map(([die]) => die.name)).toEqual(['first', 'second']);
    });

    it('rolls nothing for a type the pool does not hold', () => {
      expect(pool.rollByType(12)).toEqual([]);
    });
  });

  describe('reading the result', () => {
    it('sums the dice', () => {
      pool.rollAll();
      expect(pool.getTotal()).toBe(pool.getValues().reduce((sum, v) => sum + v, 0));
    });

    it('lists the values in pool order', () => {
      pool.rollAll();
      expect(pool.getValues()).toEqual(pool.getDice().map((d) => d.value));
    });

    it('reports whether any die shows a value', () => {
      pool.rollAll();
      const shown = pool.getValues()[0];
      expect(pool.hasValue(shown)).toBe(true);
      expect(pool.hasValue(999)).toBe(false);
    });

    it('counts how many dice show a value', () => {
      pool.rollAll();
      const values = pool.getValues();
      for (const value of new Set(values)) {
        expect(pool.countValue(value)).toBe(values.filter((v) => v === value).length);
      }
    });

    it('counts zero for a value nothing shows', () => {
      expect(pool.countValue(999)).toBe(0);
    });
  });

  describe('determinism', () => {
    it('rolls identically for the same seed', () => {
      const first = newGame('same');
      const second = newGame('same');
      expect(first.pool.rollAll().map(([, v]) => v))
        .toEqual(second.pool.rollAll().map(([, v]) => v));
    });

    it('rolls differently for a different seed', () => {
      const rolls = (seed: string) => {
        const g = newGame(seed);
        return Array.from({ length: 5 }, () => g.pool.rollAll().map(([, v]) => v)).flat();
      };
      expect(rolls('alpha')).not.toEqual(rolls('beta'));
    });
  });
});
