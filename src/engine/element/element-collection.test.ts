/**
 * FLOW-04 regression coverage for ElementCollection.shuffle()'s RNG
 * requirement: the `= Math.random` default was removed, making `random` a
 * required parameter (clean break, zero callers confirmed).
 */
import { describe, it, expect } from 'vitest';
import { ElementCollection } from './element-collection.js';
import { Game, GameElement, Piece, Player, Space } from '../index.js';
import type { GameOptions } from '../index.js';

describe('ElementCollection.shuffle', () => {
  it('shuffles deterministically using a stub rng', () => {
    const collection = ElementCollection.from([1, 2, 3, 4, 5]) as ElementCollection<number>;

    // Deterministic stub sequence for Fisher-Yates: always pick index 0.
    let calls = 0;
    const stubRng = () => {
      calls++;
      return 0;
    };

    collection.shuffle(stubRng);

    // Fisher-Yates with random()=0 always swaps element i with element 0,
    // producing a fully reversed-ish deterministic order for this input.
    expect(collection).toEqual([2, 3, 4, 5, 1]);
    expect(calls).toBe(4);
  });

  it('rejects being invoked without an rng at runtime (no Math.random default)', () => {
    const collection = ElementCollection.from([1, 2, 3]) as ElementCollection<number>;
    // TypeScript rejects this at compile time (shuffle(random: () => number)
    // has no default). Simulate an untyped/JS caller bypassing the type
    // system to assert there is no silent Math.random fallback at runtime.
    const untypedShuffle = collection.shuffle as (random?: () => number) => ElementCollection<number>;
    expect(() => untypedShuffle.call(collection)).toThrow();
  });
});

// #283: a finder's predicates are typed for the class it names, so they are
// asked about that class only. Asking them about every element walked read
// fields that do not exist on the others and, on a world's offer road, wrapped
// each of those elements in a read-only projection -- 90% of a 15-30 second
// command in `boardsmith dev`.
describe('ElementCollection finders with a class and a predicate', () => {
  class Crate extends Piece<FinderGame> {}
  class Hero extends Piece<FinderGame> {
    seat = 0;
  }
  class Yard extends Space<FinderGame> {}
  class FinderGame extends Game<FinderGame, Player> {
    constructor(options: GameOptions) {
      super(options);
      this.registerElements([Yard, Crate, Hero]);
    }
  }

  function yard() {
    const game = new FinderGame({ playerCount: 2, seed: 'finder' });
    const here = game.create(Yard, 'here');
    for (let i = 0; i < 50; i++) here.create(Crate, `crate-${i}`);
    here.create(Hero, 'one').seat = 1;
    here.create(Hero, 'two').seat = 2;
    return game;
  }

  it('asks the predicate about elements of the named class only', () => {
    const game = yard();
    const asked: GameElement[] = [];
    const found = game.first(Hero, (hero) => {
      asked.push(hero);
      return hero.seat === 2;
    });

    expect(found?.name).toBe('two');
    expect(asked.every((element) => element instanceof Hero)).toBe(true);
    expect(asked).toHaveLength(2);
  });

  it('still asks a class-less finder about every element', () => {
    const game = yard();
    let asked = 0;
    game.all((element) => {
      asked += 1;
      return element instanceof Hero;
    });
    expect(asked).toBe(game.all().length);
  });
});
