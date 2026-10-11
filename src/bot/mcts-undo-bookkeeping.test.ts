import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  actionStep,
  simultaneousActionStep,
  loop,
  eachPlayer,
  execute,
  sequence,
  type GameOptions,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';

// ============================================================================
// v4.8-MCTS-UNDO: MCTS used to roll the search game back with an incremental
// command undo, which reverted only recorded commands. It did NOT restore
// plain-property mutations (`game.finish()`'s `settings.winners`/`phase`) or
// the flow engine's own internal bookkeeping (`awaitingPlayers[].completed`,
// mutated in place by `resumeSimultaneousAction`). The search game is now
// reset by a full restore of the root snapshot. Both fixtures below drive the
// bot's low-level EXPAND/BACKPROPAGATE primitives directly (mirrors
// mcts-redaction.test.ts fixture 2) so the check is isolated to exactly
// `backpropagateAndRestoreRoot`, with no tree search nondeterminism involved.
//
// Fixture 1 deliberately avoids touching any GameElement (uses a plain
// `picks` dict instead of pieces) so the flow-bookkeeping case is isolated
// from element moves, which mcts-element-rollback.test.ts covers.
// ============================================================================

class SimultaneousGame extends Game<SimultaneousGame, Player> {
  picks!: Record<number, string>;

  constructor(options: GameOptions) {
    super(options);
    this.picks = {};

    this.registerAction(
      Action.create('pick')
        .chooseFrom('choice', {
          prompt: 'Pick one',
          choices: (ctx) => {
            const game = ctx.game as SimultaneousGame;
            const taken = new Set(Object.values(game.picks));
            return ['x', 'y', 'z'].filter((c) => !taken.has(c));
          },
        })
        .execute((args, ctx) => {
          const game = ctx.game as SimultaneousGame;
          game.picks = { ...game.picks, [ctx.player.seat]: args.choice as string };
          return { success: true };
        })
    );

    this.setFlow({
      root: simultaneousActionStep({
        actions: ['pick'],
        playerDone: (ctx, player) =>
          (ctx.game as SimultaneousGame).picks[player.seat] !== undefined,
      }),
    });
  }

  /** Over once every seat has picked, with no winner. */
  override isFinished(): boolean {
    return super.isFinished() || Object.keys(this.picks).length >= this.players.length;
  }
}

function createSimultaneousGame(seed: string) {
  const game = new SimultaneousGame({
    playerCount: 2,
    playerNames: ['Bot', 'Opponent'],
    seed,
  });
  game.startFlow();
  return game;
}

describe('MCTS undo restores flow-bookkeeping (v4.8-MCTS-UNDO)', () => {
  it('a re-expansion after undo is not wrongly rejected because a co-decider stayed "completed"', () => {
    const game = createSimultaneousGame('undo-bookkeeping-1');
    const bot: any = new MCTSBot(
      game,
      SimultaneousGame,
      'simultaneous',
      1,
      [],
      { iterations: 1, playoutDepth: 0, seed: 'undo-bookkeeping-1', async: false, usePNS: false, useRAVE: false },
    );

    // Set up the search sandbox exactly as runSearch() does, but drive
    // EXPAND/BACKPROPAGATE directly so the test is deterministic.
    bot.rootSnapshot = bot.captureSnapshot();
    bot.searchGame = bot.restoreGame(bot.rootSnapshot);

    const rootFlowState = bot.searchGame.getFlowState();
    const root = bot.createNode(
      rootFlowState,
      null,
      null,
      [
        { action: 'pick', args: { choice: 'x' } },
        { action: 'pick', args: { choice: 'y' } },
        { action: 'pick', args: { choice: 'z' } },
      ],
    );

    // First simulated branch: seat 1 picks 'x'. This completes seat 1 in the
    // flow engine's OWN (private) awaitingPlayers bookkeeping.
    const child = bot.expandIncremental(root);
    expect((bot.searchGame as SimultaneousGame).picks[1]).toBe('x');
    const seat1AfterPick = child.flowState.awaitingPlayers.find((p: any) => p.playerIndex === 1);
    expect(seat1AfterPick.completed).toBe(true);

    // BACKPROPAGATE: restore the root state.
    bot.backpropagateAndRestoreRoot(child, 0.5, [], []);

    // Second simulated branch at the SAME root: seat 1 picks 'y' (the next
    // untried move). This must succeed exactly like the first branch did --
    // the searchGame is supposed to be back at the root's flow state.
    const child2 = bot.expandIncremental(root);

    // Root cause proof: pre-fix, the flow engine's internal awaitingPlayers
    // bookkeeping still marks seat 1 "completed" from the undone branch, so
    // resumeSimultaneousAction rejects the action BEFORE executing it --
    // `picks[1]` is never updated to 'y', and the flow state carries an
    // actionError.
    expect(child2.flowState.actionError).toBeUndefined();
    expect((bot.searchGame as SimultaneousGame).picks[1]).toBe('y');
  });

  it('a re-expansion after undo is not wrongly rejected because game.finish() left phase/winners set', () => {
    class FinishGame extends Game<FinishGame, Player> {
      constructor(options: GameOptions) {
        super(options);

        this.registerAction(
          Action.create('play')
            .chooseFrom('option', { prompt: 'Pick', choices: ['a', 'b', 'c'] })
            .execute((_args, ctx) => {
              // Every play finishes the game immediately -- this is the
              // narrowest reproduction of `continueFlow` setting
              // `this.phase = 'finished'` / `this.settings.winners` as a
              // plain-property side effect outside the command system.
              ctx.game.finish([ctx.game.getPlayer(1)!]);
              return { success: true };
            })
        );

        this.setFlow({
          root: loop({
            maxIterations: 5,
            do: sequence(
              execute((ctx) => {
                // no-op execute so the loop has more than one node
              }),
              eachPlayer({
                do: actionStep({ actions: ['play'], skipIf: (ctx) => ctx.game.isFinished() }),
              }),
            ),
          }),
        });
      }
    }

    const game = new FinishGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'undo-finish-1' });
    game.startFlow();

    const bot: any = new MCTSBot(
      game,
      FinishGame,
      'finish-game',
      1,
      [],
      { iterations: 1, playoutDepth: 0, seed: 'undo-finish-1', async: false, usePNS: false, useRAVE: false },
    );

    bot.rootSnapshot = bot.captureSnapshot();
    bot.searchGame = bot.restoreGame(bot.rootSnapshot);

    const rootFlowState = bot.searchGame.getFlowState();
    const root = bot.createNode(
      rootFlowState,
      null,
      null,
      [
        { action: 'play', args: { option: 'a' } },
        { action: 'play', args: { option: 'b' } },
        { action: 'play', args: { option: 'c' } },
      ],
    );

    // First simulated branch: seat 1 plays 'a', finishing the game.
    const child = bot.expandIncremental(root);
    expect(child.flowState.complete).toBe(true);
    expect((bot.searchGame as FinishGame).isFinished()).toBe(true);
    expect((bot.searchGame as any).settings.winners).toEqual([1]);

    // BACKPROPAGATE: restore the root state.
    bot.backpropagateAndRestoreRoot(child, 1, [], []);

    // Root cause proof: `game.finish()` sets `phase`/`settings.winners` as
    // plain properties -- the old command undo (element-tree only) never reverted
    // them, which left the searchGame claiming the game was finished even
    // though we were logically back at the (unfinished) root.
    expect((bot.searchGame as FinishGame).isFinished()).toBe(false);
    expect((bot.searchGame as any).settings.winners).toBeUndefined();

    // Second simulated branch at the SAME root must behave identically to
    // the first: it should also be able to finish the game (not silently
    // no-op because the searchGame thinks the game already ended).
    const child2 = bot.expandIncremental(root);
    expect(child2.flowState.complete).toBe(true);
    expect((bot.searchGame as FinishGame).isFinished()).toBe(true);
  });
});
