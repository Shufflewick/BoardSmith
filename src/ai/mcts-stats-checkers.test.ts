/**
 * Checkers-bot integration test for MCTSBot.playWithStats().
 *
 * This file is excluded from vitest because it depends on the
 * @boardsmith/checkers-rules package, which is available only when the
 * ~/BoardSmithGames/checkers symlink is present in node_modules.
 *
 * See vitest.config.ts for the exclusion entry.
 * Unit tests (no external dependencies) live in src/ai/mcts-stats.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { CheckersGame, getCheckersObjectives } from '@boardsmith/checkers-rules';
import { MCTSBot } from './mcts-bot.js';

function createCheckersGame(): CheckersGame {
  const game = new CheckersGame({
    playerCount: 2,
    playerNames: ['Player 1', 'Player 2'],
    seed: 'mcts-stats-checkers-test',
  });
  game.startFlow();
  return game;
}

describe('MCTSBot.playWithStats() — checkers integration', () => {
  it('returns non-empty stats for a checkers starting position', async () => {
    const game = createCheckersGame();
    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,
      [],
      { iterations: 50, playoutDepth: 3, async: false },
      { objectives: getCheckersObjectives() },
    );

    const { stats } = await bot.playWithStats();
    expect(stats.length).toBeGreaterThan(0);
  });

  it('stats include the recommended move', async () => {
    const game = createCheckersGame();
    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,
      [],
      { iterations: 50, playoutDepth: 3, async: false },
      { objectives: getCheckersObjectives() },
    );

    const { move, stats } = await bot.playWithStats();

    const statMoves = stats.map(s => JSON.stringify(s.move));
    expect(statMoves).toContain(JSON.stringify(move));
  });

  it("recommended move's args include a 'to' property (hint/heatmap anchor)", async () => {
    const game = createCheckersGame();
    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,
      [],
      { iterations: 50, playoutDepth: 3, async: false },
      { objectives: getCheckersObjectives() },
    );

    const { move } = await bot.playWithStats();

    // Checkers move args contain { from: <id>, to: <id> }.
    // The 'to' field is used by the session layer as the hint/heatmap anchor.
    expect(move.args).toHaveProperty('to');
    expect(move.args.to).toBeDefined();
  });

  it('all stats values are within [0, 1]', async () => {
    const game = createCheckersGame();
    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,
      [],
      { iterations: 50, playoutDepth: 3, async: false },
      { objectives: getCheckersObjectives() },
    );

    const { stats } = await bot.playWithStats();
    for (const stat of stats) {
      expect(stat.value).toBeGreaterThanOrEqual(0);
      expect(stat.value).toBeLessThanOrEqual(1);
    }
  });
});
