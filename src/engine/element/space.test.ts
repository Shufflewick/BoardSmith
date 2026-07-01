/**
 * FLOW-04 regression coverage for Space.shuffleInternal()'s RNG source.
 *
 * - A game-attached Space shuffles deterministically using the seeded rng
 *   inherited from Game._ctx.random (same seed -> same order).
 * - A Space with no reachable seeded rng throws an actionable Error instead
 *   of silently falling back to Math.random.
 */
import { describe, it, expect } from 'vitest';
import { Game, Space, Piece, Player } from '../index.js';

class TestGame extends Game<TestGame, Player> {}

class Token extends Piece<TestGame> {
  label!: string;
}

function buildDeck(game: TestGame): Space<TestGame> {
  const deck = game.create(Space, 'deck');
  for (let i = 0; i < 10; i++) {
    deck.create(Token, `token-${i}`, { label: `token-${i}` });
  }
  return deck;
}

describe('Space.shuffleInternal', () => {
  it('shuffles deterministically using the game-attached seeded rng', () => {
    const gameA = new TestGame({ playerCount: 2, seed: 'space-shuffle-seed' });
    const deckA = buildDeck(gameA);
    deckA.shuffle();
    const orderA = deckA.all(Token).map((t) => t.label);

    const gameB = new TestGame({ playerCount: 2, seed: 'space-shuffle-seed' });
    const deckB = buildDeck(gameB);
    deckB.shuffle();
    const orderB = deckB.all(Token).map((t) => t.label);

    expect(orderA).toEqual(orderB);
    // Sanity: shuffle actually reorders (not a no-op on 10 items).
    expect(orderA).not.toEqual(
      Array.from({ length: 10 }, (_, i) => `token-${i}`),
    );
  });

  it('throws an actionable error when no seeded rng is reachable', () => {
    // Constructed with an empty context: no Game, no `random`.
    const disconnected = new Space({} as never);
    expect(() => disconnected.shuffleInternal()).toThrow(
      /seeded random number generator is reachable/i,
    );
    expect(() => disconnected.shuffleInternal()).toThrow(/Game/);
  });
});
