import { describe, it, expect } from 'vitest';
import { createTestGame } from '@boardsmith/testing';
import { DemoGame, DemoPlayer } from '../src/rules/game.js';
import { Card } from '../src/rules/elements.js';

describe('DemoGame', () => {
  it('should create a game with correct number of cards', () => {
    // Use createTestGame which properly initializes the game with flow
    const testGame = createTestGame(DemoGame, { playerCount: 2, seed: 'test' });
    // Deck should have 52 - (5 * 2) = 42 cards after dealing 5 to each player
    expect(testGame.game.deck.all(Card).length).toBe(42);
  });

  it('should deal 5 cards to each player', () => {
    const testGame = createTestGame(DemoGame, { playerCount: 2, seed: 'test' });
    for (const player of testGame.game.players as DemoPlayer[]) {
      expect(player.hand.all(Card).length).toBe(5);
    }
  });
});
