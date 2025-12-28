import { describe, it, expect } from 'vitest';
import { DemoComplexUiInteractionsGame } from '../src/rules/game.js';

describe('DemoComplexUiInteractionsGame', () => {
  it('should create a game with correct number of cards', () => {
    const game = new DemoComplexUiInteractionsGame({ playerCount: 2, seed: 'test' });
    game.setup();
    expect(game.deck.all().length).toBe(52);
  });

  it('should deal 5 cards to each player', () => {
    const game = new DemoComplexUiInteractionsGame({ playerCount: 2, seed: 'test' });
    game.setup();
    game.start();
    for (const player of game.players) {
      expect(player.hand.all().length).toBe(5);
    }
  });
});
