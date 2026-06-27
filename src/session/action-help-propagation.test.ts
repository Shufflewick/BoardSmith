import { describe, it, expect } from 'vitest';
import { Game, Player, Action } from '../engine/index.js';
import { buildActionMetadata, buildSingleActionMetadata } from './utils.js';

class TestGame extends Game<TestGame, Player> {}

function makeGame(): { game: TestGame; player: Player } {
  const game = new TestGame({ playerCount: 1 });

  const moveAction = Action.create<TestGame>('move')
    .help('Select a piece to move to an adjacent square.')
    .execute(() => {});

  const passAction = Action.create<TestGame>('pass')
    .prompt('Pass')
    .execute(() => {});

  (game as any)._actions = new Map([
    ['move', moveAction],
    ['pass', passAction],
  ]);

  const player = game.getPlayer(1)!;
  return { game, player };
}

describe('help propagation through session build functions', () => {
  describe('buildActionMetadata (initial actions path)', () => {
    it('copies help into ActionMetadata when help is set', () => {
      const { game, player } = makeGame();
      const metadata = buildActionMetadata(game, player, ['move']);
      expect(metadata['move']?.help).toBe('Select a piece to move to an adjacent square.');
    });

    it('leaves help undefined when no help is set', () => {
      const { game, player } = makeGame();
      const metadata = buildActionMetadata(game, player, ['pass']);
      expect(metadata['pass']?.help).toBeUndefined();
    });
  });

  describe('buildSingleActionMetadata (followUp actions path)', () => {
    it('copies help into ActionMetadata when help is set', () => {
      const { game, player } = makeGame();
      const metadata = buildSingleActionMetadata(game, player, 'move');
      expect(metadata?.help).toBe('Select a piece to move to an adjacent square.');
    });

    it('leaves help undefined when no help is set', () => {
      const { game, player } = makeGame();
      const metadata = buildSingleActionMetadata(game, player, 'pass');
      expect(metadata?.help).toBeUndefined();
    });
  });
});
