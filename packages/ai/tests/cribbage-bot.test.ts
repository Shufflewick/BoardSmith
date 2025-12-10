import { describe, it, expect } from 'vitest';
import { CribbageGame } from '@boardsmith/cribbage-rules';
import { MCTSBot } from '../src/mcts-bot.js';
import { DIFFICULTY_PRESETS } from '../src/types.js';

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

    // Create bot for player 0
    const bot = new MCTSBot(
      game,
      CribbageGame,
      'cribbage',
      0,
      [],
      { iterations: 1, playoutDepth: 1, async: false }
    );

    // Bot should be able to enumerate moves
    const moves = (bot as any).enumerateMoves(game, flowState);
    console.log(`Bot found ${moves.length} moves for player 0`);
    console.log('First 5 moves:', moves.slice(0, 5));

    expect(moves.length).toBeGreaterThan(0);

    // Bot should be able to play
    const move = await bot.play();
    console.log('Bot chose move:', move);

    expect(move).toBeDefined();
    expect(move.action).toBe('discard');
  });

  it('should handle simultaneous discard phase for player 1', async () => {
    const game = createCribbageGame();
    const flowState = game.getFlowState();

    // Create bot for player 1 (the typical AI player)
    const bot = new MCTSBot(
      game,
      CribbageGame,
      'cribbage',
      1, // Player 1
      [],
      { iterations: 1, playoutDepth: 1, async: false }
    );

    // Bot should be able to enumerate moves for player 1
    const moves = (bot as any).enumerateMoves(game, flowState);
    console.log(`Bot found ${moves.length} moves for player 1`);

    expect(moves.length).toBeGreaterThan(0);

    // canBotAct should return true for player 1 in simultaneous phase
    const canAct = (bot as any).canBotAct(flowState);
    console.log('canBotAct for player 1:', canAct);
    expect(canAct).toBe(true);

    // Bot should be able to play
    const move = await bot.play();
    console.log('Bot (player 1) chose move:', move);

    expect(move).toBeDefined();
    expect(move.action).toBe('discard');
  });

  it('should complete multiple discards', async () => {
    const game = createCribbageGame();

    // Create bot for player 0
    const bot0 = new MCTSBot(
      game,
      CribbageGame,
      'cribbage',
      0,
      [],
      { iterations: 1, playoutDepth: 1, async: false }
    );

    // First discard
    const move1 = await bot0.play();
    console.log('Bot discard 1:', move1);
    expect(move1.action).toBe('discard');

    // Apply the move
    game.continueFlow(move1.action, move1.args, 0);

    // Check if bot can still act (should need 2nd discard)
    const flowState2 = game.getFlowState();
    console.log('After first discard:', JSON.stringify(flowState2, null, 2));

    // Create new bot instance with updated state
    const bot0b = new MCTSBot(
      game,
      CribbageGame,
      'cribbage',
      0,
      [],
      { iterations: 1, playoutDepth: 1, async: false }
    );

    // Second discard
    const move2 = await bot0b.play();
    console.log('Bot discard 2:', move2);
    expect(move2.action).toBe('discard');
  });
});
