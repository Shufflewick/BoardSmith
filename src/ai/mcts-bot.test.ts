import { describe, it, expect } from 'vitest';
import { CheckersGame, getCheckersObjectives } from '@boardsmith/checkers-rules';
import { MCTSBot } from './mcts-bot.js';
import { DIFFICULTY_PRESETS } from './types.js';

function createCheckersGame() {
  const game = new CheckersGame({
    playerCount: 2,
    playerNames: ['Player 1', 'Player 2'],
    seed: 'test-seed',
  });
  game.startFlow();
  return game;
}

describe('MCTSBot Performance', () => {
  it('should enumerate moves quickly', () => {
    const game = createCheckersGame();
    const flowState = game.getFlowState();

    console.log('Flow state:', JSON.stringify(flowState, null, 2));

    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,  // 1-indexed player position
      [],
      { iterations: 1, playoutDepth: 1 }
    );

    const start = performance.now();
    // Access private method via any cast for testing
    const moves = (bot as any).enumerateMoves(game, flowState);
    const elapsed = performance.now() - start;

    console.log(`Enumerated ${moves.length} moves in ${elapsed.toFixed(2)}ms`);
    console.log('Moves:', moves.slice(0, 5));

    expect(moves.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100); // Should be < 100ms
  });

  it('should complete 1 iteration quickly', async () => {
    const game = createCheckersGame();

    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,  // 1-indexed player position
      [],
      { iterations: 1, playoutDepth: 5, async: false }
    );

    const start = performance.now();
    const move = await bot.play();
    const elapsed = performance.now() - start;

    console.log(`1 iteration completed in ${elapsed.toFixed(2)}ms`);
    console.log('Move:', move);

    expect(move).toBeDefined();
    expect(move.action).toBe('move');
    expect(elapsed).toBeLessThan(500); // Should be < 500ms for 1 iteration
  });

  it('should complete easy difficulty (10 iterations) in reasonable time', async () => {
    const game = createCheckersGame();

    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,  // 1-indexed player position
      [],
      { ...DIFFICULTY_PRESETS.easy, async: false }
    );

    const start = performance.now();
    const move = await bot.play();
    const elapsed = performance.now() - start;

    console.log(`Easy (10 iterations) completed in ${elapsed.toFixed(2)}ms`);
    console.log('Move:', move);

    expect(move).toBeDefined();
    expect(elapsed).toBeLessThan(2000); // Should be < 2 seconds
  });

  it('should complete medium difficulty (50 iterations) in reasonable time', async () => {
    const game = createCheckersGame();

    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,  // 1-indexed player position
      [],
      { ...DIFFICULTY_PRESETS.medium, async: false }
    );

    const start = performance.now();
    const move = await bot.play();
    const elapsed = performance.now() - start;

    console.log(`Medium (50 iterations) completed in ${elapsed.toFixed(2)}ms`);
    console.log('Move:', move);

    expect(move).toBeDefined();
    expect(elapsed).toBeLessThan(5000); // Should be < 5 seconds
  });

  it('should profile individual operations', async () => {
    const game = createCheckersGame();
    const flowState = game.getFlowState();

    const bot = new MCTSBot(
      game,
      CheckersGame,
      'checkers',
      1,  // 1-indexed player position
      [],
      { iterations: 1, playoutDepth: 1, async: false }
    );

    // Test snapshot creation
    let start = performance.now();
    const snapshot = (bot as any).captureSnapshot();
    let elapsed = performance.now() - start;
    console.log(`Snapshot creation: ${elapsed.toFixed(2)}ms`);

    // Test game restoration
    start = performance.now();
    const restoredGame = (bot as any).restoreGame(snapshot);
    elapsed = performance.now() - start;
    console.log(`Game restoration: ${elapsed.toFixed(2)}ms`);

    // Test move enumeration
    start = performance.now();
    const moves = (bot as any).enumerateMoves(restoredGame, flowState);
    elapsed = performance.now() - start;
    console.log(`Move enumeration: ${elapsed.toFixed(2)}ms, ${moves.length} moves`);

    expect(snapshot).toBeDefined();
    expect(restoredGame).toBeDefined();
    expect(moves.length).toBeGreaterThan(0);
  });
});
