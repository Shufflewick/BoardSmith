import { describe, it, expect } from 'vitest';
import { Game, Player, createSnapshot, createPlayerView } from '../index.js';
import { GameRunner } from '../../runtime/index.js';

class StatusGame extends Game<StatusGame, Player> {}

const newGame = () => new StatusGame({ playerCount: 3, seed: 'status' });

describe('Player.status', () => {
  it('defaults every seat to active', () => {
    const game = newGame();
    for (const player of game.all(Player)) {
      expect(player.status).toBe('active');
      expect(player.isActive).toBe(true);
    }
  });

  it('isActive is false for both non-active states', () => {
    const game = newGame();
    game.getPlayerOrThrow(1).status = 'dormant';
    game.getPlayerOrThrow(2).status = 'eliminated';

    expect(game.getPlayerOrThrow(1).isActive).toBe(false);
    expect(game.getPlayerOrThrow(2).isActive).toBe(false);
    expect(game.getPlayerOrThrow(3).isActive).toBe(true);
  });

  it('survives a snapshot round-trip', () => {
    const game = newGame();
    game.getPlayerOrThrow(2).status = 'eliminated';
    game.getPlayerOrThrow(3).status = 'dormant';

    const snapshot = createSnapshot(game, 'status-game', [], 'status');
    const restored = GameRunner.fromSnapshot(snapshot, StatusGame).game;

    expect(restored.getPlayerOrThrow(1).status).toBe('active');
    expect(restored.getPlayerOrThrow(2).status).toBe('eliminated');
    expect(restored.getPlayerOrThrow(3).status).toBe('dormant');
  });

  it('is visible in every seat player view — who is still in the game is public', () => {
    const game = newGame();
    game.getPlayerOrThrow(2).status = 'eliminated';

    for (const seat of [1, 2, 3]) {
      const view = createPlayerView(game, seat);
      const players = (view.state.children ?? []).filter(c => c.attributes?.$type === 'player');
      const seat2 = players.find(p => p.attributes.seat === 2)!;
      expect(seat2.attributes.status, `seat ${seat}'s view`).toBe('eliminated');
    }
  });
});
