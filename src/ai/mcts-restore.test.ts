import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, sequence, actionStep, execute, loop, eachPlayer, createSnapshot, type GameOptions } from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';

// ============================================================================
// Test game where an execute block finishes the game during replay.
// This reproduces the root cause of the infinite loop bug: restoreGame()
// replays actions, the execute block finishes the game mid-loop, and the
// remaining actions become stale.
//
// The action has a chooseFrom selection so that there are multiple moves
// available (MCTS short-circuits and skips cloning when there's only 1 move).
// ============================================================================

class ExecuteFinishGame extends Game<ExecuteFinishGame, Player> {
  roundCount!: number;

  constructor(options: GameOptions) {
    super(options);
    this.roundCount = 0;

    this.registerAction(
      Action.create('play')
        .chooseFrom('option', {
          prompt: 'Pick an option',
          choices: ['a', 'b', 'c'],
        })
        .execute((_args, ctx) => {
          (ctx.game as ExecuteFinishGame).roundCount++;
          return { success: true };
        })
    );

    this.setFlow(defineFlow({
      root: loop({
        maxIterations: 20,
        do: sequence(
          // This execute block checks if the game should end BEFORE the action step.
          // During replay, after enough actions, this will call finish() and the loop
          // will end before reaching the actionStep, causing flow to complete.
          execute((ctx) => {
            if ((ctx.game as ExecuteFinishGame).roundCount >= 3) {
              ctx.game.finish([ctx.game.getPlayer(1)!]);
            }
          }),
          eachPlayer({
            do: actionStep({
              actions: ['play'],
              skipIf: (ctx) => ctx.game.isFinished(),
            }),
          }),
        ),
      }),
      isComplete: (ctx) => ctx.game.isFinished(),
      getWinners: (ctx) => ctx.game.isFinished() ? [ctx.game.getPlayer(1)!] : [],
    }));
  }
}

function createExecuteFinishGame() {
  const game = new ExecuteFinishGame({
    playerCount: 2,
    playerNames: ['Alice', 'Bot'],
    seed: 'test-execute-finish',
  });
  game.startFlow();
  return game;
}

describe('MCTSBot restoreGame with execute block', () => {
  it('restoreGame handles flow completing during replay', () => {
    // Play enough rounds to trigger the execute block finish
    const game = createExecuteFinishGame();
    const history: any[] = [];

    // Play rounds until the game finishes
    while (!game.isFinished()) {
      const flowState = game.getFlowState()!;
      if (!flowState.awaitingInput) break;
      const player = flowState.currentPlayer!;
      game.continueFlow('play', { option: 'a' }, player);
      history.push({ name: 'play', player, args: { option: 'a' } });
    }

    expect(game.isFinished()).toBe(true);
    expect(history.length).toBeGreaterThan(0);

    // Create a snapshot with the full action history.
    // When restoreGame replays these, the execute block will finish the game
    // partway through, and the remaining actions are stale.
    const snapshot = createSnapshot(game, 'execute-finish', history, 'test-execute-finish');

    const bot = new MCTSBot(
      game,
      ExecuteFinishGame,
      'execute-finish',
      2,
      history,
      { iterations: 1, playoutDepth: 1 }
    );

    // restoreGame should return a game (not throw), even though flow completes mid-replay
    const restoredGame = (bot as any).restoreGame(snapshot);
    expect(restoredGame).toBeDefined();
    expect(restoredGame.isFinished()).toBe(true);
  });

  it('playSingle throws actionable error when clone diverges', async () => {
    // Play a complete game to get the full action history
    const finishedGame = createExecuteFinishGame();
    const history: any[] = [];

    while (!finishedGame.isFinished()) {
      const flowState = finishedGame.getFlowState()!;
      if (!flowState.awaitingInput) break;
      const player = flowState.currentPlayer!;
      finishedGame.continueFlow('play', { option: 'a' }, player);
      history.push({ name: 'play', player, args: { option: 'a' } });
    }

    expect(finishedGame.isFinished()).toBe(true);

    // Create a "live" game that's still in progress (only 1 action played).
    // Pass the FULL history to the bot. When playSingle calls captureSnapshot(),
    // it captures the live game's state + full action history. During restoreGame(),
    // the replay will process all actions through the flow engine, eventually
    // hitting the execute block that calls finish().
    const liveGame = createExecuteFinishGame();
    liveGame.continueFlow('play', { option: 'a' }, liveGame.getFlowState()!.currentPlayer!);
    expect(liveGame.getFlowState()!.awaitingInput).toBe(true);

    const bot = new MCTSBot(
      liveGame,
      ExecuteFinishGame,
      'execute-finish',
      2,
      history, // Full history including actions that trigger finish
      { iterations: 1, playoutDepth: 1, async: false }
    );

    // The bot should throw because the cloned game diverges (flow completes during replay)
    await expect(bot.play()).rejects.toThrow('flow diverged during replay');
  });
});
