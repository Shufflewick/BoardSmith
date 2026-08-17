/**
 * Engine-level contract for `GameOptions.randomness` and the
 * {@link RandomnessForbiddenError} it throws. The session-level consequences
 * (order-entry ops, undo fencing) live in
 * `src/session/testing/random-scumming.test.ts`; this file pins the engine
 * surface itself — the exported error class and the fact that EVERY draw path
 * on a forbidden game throws.
 */
import { describe, it, expect } from 'vitest';
import { Game, Piece, Player, RandomnessForbiddenError, Space } from '../index.js';

class Token extends Piece<RandomGame> {}
class Pile extends Space<RandomGame> {}

class RandomGame extends Game<RandomGame, Player> {}

const makeGame = (randomness?: 'allowed' | 'forbidden') =>
  new RandomGame({ playerCount: 2, seed: 'fixed-seed', randomness });

describe('RandomnessForbiddenError', () => {
  it('is an Error identifiable by name', () => {
    const error = new RandomnessForbiddenError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RandomnessForbiddenError');
  });

  it('names the policy and the fix rather than just failing', () => {
    const { message } = new RandomnessForbiddenError();
    expect(message).toContain('forbids randomness');
    expect(message).toContain('order-entry');
    expect(message).toContain('resolution session');
  });

  it('is catchable by class from outside the engine', () => {
    const game = makeGame('forbidden');
    let caught: unknown;
    try {
      game.random();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RandomnessForbiddenError);
  });
});

describe("randomness: 'allowed' (the default)", () => {
  it('draws deterministically from the seed', () => {
    const first = makeGame();
    const second = makeGame();
    expect(Array.from({ length: 5 }, () => first.random()))
      .toEqual(Array.from({ length: 5 }, () => second.random()));
  });

  it('shuffles without complaint', () => {
    const game = makeGame();
    const pile = game.create(Pile, 'pile');
    for (let i = 0; i < 5; i++) pile.create(Token, `t${i}`);
    expect(() => pile.shuffle()).not.toThrow();
  });

  it('is the behaviour when the option is omitted entirely', () => {
    expect(() => new RandomGame({ playerCount: 2 }).random()).not.toThrow();
  });
});

describe("randomness: 'forbidden'", () => {
  it('throws on a direct draw', () => {
    expect(() => makeGame('forbidden').random()).toThrow(RandomnessForbiddenError);
  });

  it('throws on a shuffle, which draws through the shared element context', () => {
    const game = makeGame('forbidden');
    const pile = game.create(Pile, 'pile');
    for (let i = 0; i < 5; i++) pile.create(Token, `t${i}`);
    expect(() => pile.shuffle()).toThrow(RandomnessForbiddenError);
  });

  it('closes the context draw path, not just the game one', () => {
    const game = makeGame('forbidden');
    expect(() => game._ctx.random()).toThrow(RandomnessForbiddenError);
  });

  it('throws on every subsequent attempt, not only the first', () => {
    const game = makeGame('forbidden');
    expect(() => game.random()).toThrow(RandomnessForbiddenError);
    expect(() => game.random()).toThrow(RandomnessForbiddenError);
  });

  it('applies from the very first instruction of a subclass constructor', () => {
    class DrawsAtConstruction extends Game<any, Player> {
      constructor(options: any) {
        super(options);
        this.random();
      }
    }
    expect(() => new DrawsAtConstruction({ playerCount: 2, randomness: 'forbidden' }))
      .toThrow(RandomnessForbiddenError);
    expect(() => new DrawsAtConstruction({ playerCount: 2 })).not.toThrow();
  });

  it('still round-trips the RNG position so snapshots keep working', () => {
    const game = makeGame('forbidden');
    const state = game.getRandomState();
    expect(typeof state).toBe('number');
    expect(() => game.setRandomState(state)).not.toThrow();
    expect(game.getRandomState()).toBe(state);
  });

  it('never advances the generator, which is what makes the session unscummable', () => {
    const game = makeGame('forbidden');
    const before = game.getRandomState();
    expect(() => game.random()).toThrow();
    expect(game.getRandomState()).toBe(before);
  });

  it('is not persisted into the snapshot — the host re-declares it per session', () => {
    const game = makeGame('forbidden');
    expect(game.getConstructorOptions()).not.toHaveProperty('randomness');
  });
});
