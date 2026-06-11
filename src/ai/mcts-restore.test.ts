import { describe, it, expect } from 'vitest';
import { Game, Player, Piece, Space, Action, defineFlow, sequence, actionStep, execute, loop, eachPlayer, createSnapshot, type GameOptions } from '../engine/index.js';
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

  it('playSingle searches authoritatively even when trailing history is stale', async () => {
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

    // Create a "live" game that's still in progress (only 1 action played) and
    // pass it the FULL (finished-game) history. captureSnapshot() captures the
    // LIVE in-progress state plus that stale trailing history.
    //
    // Under authoritative restore, restoreGame() adopts snapshot.state +
    // snapshot.flowState directly and IGNORES the action history — so the clone
    // is the live in-progress game, never the finished one. There is no replay
    // and therefore nothing to "diverge": the bot simply searches and returns a
    // legal move. (The old replay-based restore re-ran the stale history, hit
    // the game-ending execute block mid-replay, and threw "flow diverged".)
    const liveGame = createExecuteFinishGame();
    liveGame.continueFlow('play', { option: 'a' }, liveGame.getFlowState()!.currentPlayer!);
    expect(liveGame.getFlowState()!.awaitingInput).toBe(true);

    const bot = new MCTSBot(
      liveGame,
      ExecuteFinishGame,
      'execute-finish',
      2,
      history, // Stale trailing history — authoritatively ignored on restore
      { iterations: 1, playoutDepth: 1, async: false }
    );

    const move = await bot.play();
    expect(move.action).toBe('play');
    expect(['a', 'b', 'c']).toContain(move.args.option);
  });

  it('restoreGame preserves direct tree mutations not recorded in command/action history', () => {
    // A pending/selection action's execute moves a piece via Piece.putInto, which
    // mutates the element tree DIRECTLY — recorded in neither commandHistory nor
    // actionHistory. The MCTS search root can carry such a mutation, so restoring
    // the root by replaying history (the old behavior) silently loses it and the
    // bot searches from the wrong position. Authoritative restore adopts the
    // serialized tree and keeps the mutation.
    class MutationGame extends Game<MutationGame, Player> {
      stash!: Space<MutationGame>;
      held!: Space<MutationGame>;
      token!: Piece<MutationGame>;

      constructor(options: GameOptions) {
        super(options);
        this.stash = this.create(Space<MutationGame>, 'stash');
        this.held = this.create(Space<MutationGame>, 'held');
        this.token = this.stash.create(Piece<MutationGame>, 'Token');

        this.registerAction(
          Action.create('noop')
            .chooseFrom('opt', { prompt: 'Pick', choices: ['a', 'b'] })
            .execute(() => ({ success: true })),
        );

        this.setFlow(defineFlow({
          root: loop({
            maxIterations: 20,
            do: actionStep({ actions: ['noop'], player: (ctx) => ctx.game.getPlayer(1)! }),
          }),
        }));
      }
    }

    const game = new MutationGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'mut' });
    game.startFlow();

    // Direct tree mutation — exactly what a pending action's execute does.
    game.token.putInto(game.held);
    expect(game.token.parent?.name).toBe('held');
    expect(game.commandHistory.length).toBe(0); // proves it is NOT a recorded command

    const snapshot = createSnapshot(game, 'mutation', [], 'mut');

    const bot = new MCTSBot(
      game,
      MutationGame,
      'mutation',
      2,
      [],
      { iterations: 1, playoutDepth: 1 },
    );

    const restored = (bot as any).restoreGame(snapshot) as MutationGame;
    const restoredToken = restored.getElementById(game.token.id);

    // The mutation must survive restore (was lost under replay: token back in stash).
    expect(restoredToken?.parent?.name).toBe('held');
  });
});
