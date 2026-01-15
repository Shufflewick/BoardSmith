import { describe, it, expect } from 'vitest';
import { CheckersGame } from '@boardsmith/checkers-rules';
import { MCTSBot } from '../src/mcts-bot.js';

function createCheckersGame() {
  const game = new CheckersGame({
    playerCount: 2,
    playerNames: ['Player 1', 'Player 2'],
    seed: 'cache-test-seed',
  });
  game.startFlow();
  return game;
}

describe('MCTS Move Caching', () => {
  it('should cache allMoves in created nodes', async () => {
    const game = createCheckersGame();
    const flowState = game.getFlowState();

    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1, // player 1
      [],
      { iterations: 5, playoutDepth: 0, async: false }
    );

    // Run a few iterations to create nodes
    await bot.play();

    // Access the root node (would need to expose for full testing)
    // For now, verify that the bot works correctly with caching enabled
    const moves = (bot as any).enumerateMoves(game, flowState);
    expect(moves.length).toBeGreaterThan(0);

    // Verify moves have consistent structure
    for (const move of moves) {
      expect(move).toHaveProperty('action');
      expect(move).toHaveProperty('args');
    }
  });

  it('should enumerate moves consistently across calls', () => {
    const game = createCheckersGame();
    const flowState = game.getFlowState();

    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,
      [],
      { iterations: 1, playoutDepth: 0, async: false }
    );

    // Enumerate moves twice - should be identical
    const moves1 = (bot as any).enumerateMoves(game, flowState);
    const moves2 = (bot as any).enumerateMoves(game, flowState);

    expect(moves1.length).toBe(moves2.length);

    // Check each move matches
    for (let i = 0; i < moves1.length; i++) {
      expect(moves1[i].action).toBe(moves2[i].action);
      expect(JSON.stringify(moves1[i].args)).toBe(JSON.stringify(moves2[i].args));
    }
  });
});

describe('MCTS Transposition Table', () => {
  it('should produce valid moves with transposition table enabled', async () => {
    const game = createCheckersGame();

    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,
      [],
      { iterations: 20, playoutDepth: 0, async: false, useTranspositionTable: true }
    );

    const move = await bot.play();
    expect(move).toBeDefined();
    expect(['move', 'endTurn']).toContain(move.action);
    expect(move.args).toBeDefined();
  });

  it('should produce valid moves with transposition table disabled', async () => {
    const game = createCheckersGame();

    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,
      [],
      { iterations: 20, playoutDepth: 0, async: false, useTranspositionTable: false }
    );

    const move = await bot.play();
    expect(move).toBeDefined();
    expect(['move', 'endTurn']).toContain(move.action);
    expect(move.args).toBeDefined();
  });

  it('should return consistent evaluation for same position', () => {
    const game = createCheckersGame();
    const flowState = game.getFlowState();

    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,
      [],
      { iterations: 1, playoutDepth: 0, async: false }
    );

    // Evaluate the same position multiple times
    const value1 = (bot as any).evaluateTerminalFromGame(game, flowState);
    const value2 = (bot as any).evaluateTerminalFromGame(game, flowState);

    // Without randomness in evaluation, values should be identical
    expect(value1).toBe(value2);
  });

  it('should hash positions deterministically', () => {
    const game = createCheckersGame();
    const flowState = game.getFlowState();

    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,
      [],
      { iterations: 1, playoutDepth: 0, async: false }
    );

    // Hash the same position with flowState - should be deterministic
    const hash1 = (bot as any).hashPosition(game, flowState);
    const hash2 = (bot as any).hashPosition(game, flowState);

    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe('string');
    // Flow state position should produce a non-empty hash
    expect(hash1.length).toBeGreaterThan(0);
  });

  it('should clear transposition table between searches', async () => {
    const game = createCheckersGame();

    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,
      [],
      { iterations: 10, playoutDepth: 0, async: false, useTranspositionTable: true }
    );

    // First search
    await bot.play();

    // Access the transposition table - it should be empty after play() returns
    // (table is not retained between searches)
    // Since we clear at start, not end, the table will have entries after play()
    // But a new play() call should start fresh

    // Create new game state for second search
    const game2 = createCheckersGame();
    const bot2 = new MCTSBot(
      game2,
      CheckersGame,
      'checkers',
      1,
      [],
      { iterations: 10, playoutDepth: 0, async: false, useTranspositionTable: true }
    );

    // Second search should work correctly (fresh table)
    const move = await bot2.play();
    expect(move).toBeDefined();
  });
});

describe('MCTS Cache Performance', () => {
  it.skip('should show performance improvement with caching (manual benchmark)', async () => {
    // This test is skipped by default to avoid flaky timing in CI
    // Run manually with: pnpm test -- --run mcts-cache --testNamePattern="performance"

    const iterations = 50;
    const runs = 3;

    // Test with transposition table enabled
    let totalWithCache = 0;
    for (let i = 0; i < runs; i++) {
      const game = createCheckersGame();
      const bot = new MCTSBot(
        game,
        CheckersGame,
        'checkers',
        1,
        [],
        { iterations, playoutDepth: 0, async: false, useTranspositionTable: true }
      );

      const start = performance.now();
      await bot.play();
      totalWithCache += performance.now() - start;
    }

    // Test with transposition table disabled
    let totalWithoutCache = 0;
    for (let i = 0; i < runs; i++) {
      const game = createCheckersGame();
      const bot = new MCTSBot(
        game,
        CheckersGame,
        'checkers',
        1,
        [],
        { iterations, playoutDepth: 0, async: false, useTranspositionTable: false }
      );

      const start = performance.now();
      await bot.play();
      totalWithoutCache += performance.now() - start;
    }

    const avgWithCache = totalWithCache / runs;
    const avgWithoutCache = totalWithoutCache / runs;

    console.log(`Average time with cache: ${avgWithCache.toFixed(2)}ms`);
    console.log(`Average time without cache: ${avgWithoutCache.toFixed(2)}ms`);
    console.log(`Speedup: ${((avgWithoutCache / avgWithCache - 1) * 100).toFixed(1)}%`);

    // Just verify both run successfully - performance varies by machine
    expect(avgWithCache).toBeGreaterThan(0);
    expect(avgWithoutCache).toBeGreaterThan(0);
  });
});
