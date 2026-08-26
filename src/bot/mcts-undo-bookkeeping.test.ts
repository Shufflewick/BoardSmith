import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
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
// v4.8-MCTS-UNDO: MCTS's incremental `undoCommands` reverts only commands
// recorded in `game.commandHistory`. It does NOT restore plain-property
// mutations (`game.finish()`'s `settings.winners`/`phase`) or the flow
// engine's own internal bookkeeping (`awaitingPlayers[].completed`, mutated
// in place by `resumeSimultaneousAction`, never recorded as a GameCommand).
// Both fixtures below drive the bot's low-level EXPAND/BACKPROPAGATE
// primitives directly (mirrors mcts-redaction.test.ts fixture 2) so the leak
// is isolated to exactly `backpropagateWithUndo`, with no tree search
// nondeterminism involved.
//
// Fixture 1 deliberately avoids touching any GameElement (uses a plain
// `picks` dict instead of pieces) so the flow-bookkeeping leak under test is
// isolated from the separate, already-documented limitation that ordinary
// element mutations (`Piece.putInto`, `create`) are never recorded as
// GameCommands in the first place (see mcts-restore.test.ts's "restoreGame
// preserves direct tree mutations..." test, which proves
// `game.commandHistory.length` stays 0 after `putInto`) -- out of scope here.
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

    this.setFlow(defineFlow({
      root: simultaneousActionStep({
        actions: ['pick'],
        playerDone: (ctx, player) =>
          (ctx.game as SimultaneousGame).picks[player.seat] !== undefined,
      }),
      isComplete: (ctx) =>
        Object.keys((ctx.game as SimultaneousGame).picks).length >= ctx.game.all(Player as any).length,
      getWinners: () => [],
    }));
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
    bot.rootCommandCount = bot.searchGame.commandHistory.length;

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
      0,
    );

    // First simulated branch: seat 1 picks 'x'. This completes seat 1 in the
    // flow engine's OWN (private) awaitingPlayers bookkeeping.
    const child = bot.expandIncremental(root);
    expect((bot.searchGame as SimultaneousGame).picks[1]).toBe('x');
    const seat1AfterPick = child.flowState.awaitingPlayers.find((p: any) => p.playerIndex === 1);
    expect(seat1AfterPick.completed).toBe(true);

    // BACKPROPAGATE: undo back to root state.
    bot.backpropagateWithUndo(child, 0.5, [], []);

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

        this.setFlow(defineFlow({
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
          isComplete: (ctx) => ctx.game.isFinished(),
          getWinners: (ctx) => ctx.game.isFinished() ? [ctx.game.getPlayer(1)!] : [],
        }));
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
    bot.rootCommandCount = bot.searchGame.commandHistory.length;

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
      0,
    );

    // First simulated branch: seat 1 plays 'a', finishing the game.
    const child = bot.expandIncremental(root);
    expect(child.flowState.complete).toBe(true);
    expect((bot.searchGame as FinishGame).isFinished()).toBe(true);
    expect((bot.searchGame as any).settings.winners).toEqual([1]);

    // BACKPROPAGATE: undo back to root state.
    bot.backpropagateWithUndo(child, 1, [], []);

    // Root cause proof: `game.finish()` sets `phase`/`settings.winners` as
    // plain properties -- undoCommands (element-tree only) never reverts
    // them, so the searchGame is left claiming the game is finished even
    // though we are logically back at the (unfinished) root.
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
