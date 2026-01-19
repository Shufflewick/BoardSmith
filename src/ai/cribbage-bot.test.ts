import { describe, it, expect } from 'vitest';
import { CribbageGame } from '@boardsmith/cribbage-rules';
import { MCTSBot } from './mcts-bot.js';
import { DIFFICULTY_PRESETS } from './types.js';

function createCribbageGame() {
  const game = new CribbageGame({
    playerCount: 2,
    playerNames: ['Player 1', 'Player 2'],
    seed: 'test-seed',
  });
  game.startFlow();
  return game;
}

describe('MCTSBot Cribbage', () => {
  it('should handle simultaneous discard phase', async () => {
    const game = createCribbageGame();
    const flowState = game.getFlowState();

    console.log('Flow state:', JSON.stringify(flowState, null, 2));

    // Should be in simultaneous action phase
    expect(flowState?.awaitingInput).toBe(true);
    expect(flowState?.awaitingPlayers).toBeDefined();
    expect(flowState?.awaitingPlayers?.length).toBe(2);

    // Create bot for player 1 (1-indexed)
    const bot = new MCTSBot(
      game,
      CribbageGame,
      'cribbage',
      1,  // 1-indexed player position
      [],
      { iterations: 1, playoutDepth: 1, async: false }
    );

    // Bot should be able to enumerate moves
    const moves = (bot as any).enumerateMoves(game, flowState);
    console.log(`Bot found ${moves.length} moves for player 1`);
    console.log('First 5 moves:', moves.slice(0, 5));

    expect(moves.length).toBeGreaterThan(0);

    // Bot should be able to play
    const move = await bot.play();
    console.log('Bot chose move:', move);

    expect(move).toBeDefined();
    expect(move.action).toBe('discard');
  });

  it('should handle simultaneous discard phase for player 2', async () => {
    const game = createCribbageGame();
    const flowState = game.getFlowState();

    // Create bot for player 2 (1-indexed, the typical AI player)
    const bot = new MCTSBot(
      game,
      CribbageGame,
      'cribbage',
      2,  // 1-indexed player position
      [],
      { iterations: 1, playoutDepth: 1, async: false }
    );

    // Bot should be able to enumerate moves for player 2
    const moves = (bot as any).enumerateMoves(game, flowState);
    console.log(`Bot found ${moves.length} moves for player 2`);

    expect(moves.length).toBeGreaterThan(0);

    // canBotAct should return true for player 2 in simultaneous phase
    const canAct = (bot as any).canBotAct(flowState);
    console.log('canBotAct for player 2:', canAct);
    expect(canAct).toBe(true);

    // Bot should be able to play
    const move = await bot.play();
    console.log('Bot (player 2) chose move:', move);

    expect(move).toBeDefined();
    expect(move.action).toBe('discard');
  });

  it('should complete discards for both players', async () => {
    const game = createCribbageGame();

    // Create bot for player 1 (1-indexed)
    const bot1 = new MCTSBot(
      game,
      CribbageGame,
      'cribbage',
      1,  // 1-indexed player position
      [],
      { iterations: 1, playoutDepth: 1, async: false }
    );

    // Player 1 discards (uses multiSelect to discard 2 cards at once)
    const move1 = await bot1.play();
    console.log('Bot 1 discard:', move1);
    expect(move1.action).toBe('discard');

    // Apply player 1's move
    game.continueFlow(move1.action, move1.args, 1);

    // Check game state - player 2 should now need to discard
    const flowState2 = game.getFlowState();
    console.log('After player 1 discard:', JSON.stringify(flowState2, null, 2));

    // Create bot for player 2
    const bot2 = new MCTSBot(
      game,
      CribbageGame,
      'cribbage',
      2,  // 1-indexed player position
      [],
      { iterations: 1, playoutDepth: 1, async: false }
    );

    // Player 2 discards
    const move2 = await bot2.play();
    console.log('Bot 2 discard:', move2);
    expect(move2.action).toBe('discard');
  });
});
