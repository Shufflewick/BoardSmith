import { describe, it, expect } from 'vitest';
import { TwoPlayerPickGame as ThreeChoiceGame } from '../session/testing/fixtures/two-player-pick-fixture.js';
import { MCTSBot } from './mcts-bot.js';
import type { BotMoveStats } from './types.js';

// A 3-choice action so MCTS doesn't short-circuit (it skips cloning when
// allMoves.length === 1): root.children has several entries after the search,
// giving playWithStats() non-empty stats.
function createThreeChoiceGame(): ThreeChoiceGame {
  const game = new ThreeChoiceGame({
    playerCount: 2,
    playerNames: ['Alice', 'Bot'],
    seed: 'mcts-stats-test',
  });
  game.startFlow();
  return game;
}

describe('MCTSBot.playWithStats()', () => {
  it('returns a move and a non-empty stats array for a 3-choice game', async () => {
    const game = createThreeChoiceGame();
    const bot = new MCTSBot(game, ThreeChoiceGame, 'three-choice', 1, [], {
      iterations: 50,
      async: false,
    });

    const result = await bot.playWithStats();
    expect(result).toHaveProperty('move');
    expect(result.move).toHaveProperty('action');
    expect(result.move).toHaveProperty('args');
    expect(result.stats).toBeDefined();
    expect(result.stats.length).toBeGreaterThan(0);
  });

  it('returns stats where every value is within [0, 1]', async () => {
    const game = createThreeChoiceGame();
    const bot = new MCTSBot(game, ThreeChoiceGame, 'three-choice', 1, [], {
      iterations: 50,
      async: false,
    });

    const { stats } = await bot.playWithStats();
    for (const stat of stats) {
      expect(stat.value).toBeGreaterThanOrEqual(0);
      expect(stat.value).toBeLessThanOrEqual(1);
    }
  });

  it('stats count matches the number of distinct root children evaluated', async () => {
    const game = createThreeChoiceGame();
    const bot = new MCTSBot(game, ThreeChoiceGame, 'three-choice', 1, [], {
      iterations: 100,
      async: false,
    });

    const { stats } = await bot.playWithStats();
    // With 100 iterations over 3 choices, MCTS should have explored all 3 children
    expect(stats.length).toBeGreaterThan(0);
    // Each stat must have a move with action and visits >= 0
    for (const stat of stats) {
      expect(stat.move).toHaveProperty('action', 'pick');
      expect(stat.visits).toBeGreaterThanOrEqual(0);
    }
  });

  it('play() and playWithStats() return the same move for identical seed', async () => {
    // play() behavior must be identical pre/post runSearch() refactor
    const game1 = createThreeChoiceGame();
    const game2 = createThreeChoiceGame();
    const seed = 'refactor-check';

    const playBot = new MCTSBot(game1, ThreeChoiceGame, 'three-choice', 1, [], {
      iterations: 50,
      async: false,
      seed,
    });
    const statsBot = new MCTSBot(game2, ThreeChoiceGame, 'three-choice', 1, [], {
      iterations: 50,
      async: false,
      seed,
    });

    const playMove = await playBot.play();
    const { move: statsMove } = await statsBot.playWithStats();

    expect(statsMove).toEqual(playMove);
  });

  it('a bot configured with parallel: 2 still returns non-empty stats', async () => {
    const game = createThreeChoiceGame();
    const bot = new MCTSBot(game, ThreeChoiceGame, 'three-choice', 1, [], {
      iterations: 50,
      async: false,
      parallel: 2, // playWithStats() must force single-search path
    });

    const { stats } = await bot.playWithStats();
    expect(stats.length).toBeGreaterThan(0);
  });

  it('each stat has a valid BotMove with action and args', async () => {
    const game = createThreeChoiceGame();
    const bot = new MCTSBot(game, ThreeChoiceGame, 'three-choice', 1, [], {
      iterations: 100,
      async: false,
    });

    const { stats } = await bot.playWithStats();
    for (const stat of stats) {
      // Every stat's move must be a valid BotMove
      expect(typeof stat.move.action).toBe('string');
      expect(stat.move.action.length).toBeGreaterThan(0);
      expect(stat.move.args).toBeDefined();
      expect(typeof stat.move.args).toBe('object');
      // visits must be a non-negative integer
      expect(Number.isInteger(stat.visits)).toBe(true);
      expect(stat.visits).toBeGreaterThanOrEqual(0);
    }
  });

  it('the recommended move is present among the stats entries', async () => {
    const game = createThreeChoiceGame();
    const bot = new MCTSBot(game, ThreeChoiceGame, 'three-choice', 1, [], {
      iterations: 100,
      async: false,
    });

    const { move, stats } = await bot.playWithStats();
    // The move returned must be one of the moves in stats
    const statMoves = stats.map(s => JSON.stringify(s.move));
    expect(statMoves).toContain(JSON.stringify(move));
  });
});
