/**
 * A finished game is a complete flow, whatever loop it is in (#492).
 *
 * `isComplete` comes from the flow and `winners` from the game, and only
 * `turnLoop` and `stateAwareLoop` used to stop on `game.isFinished()`. A game
 * that called `this.finish([p])` from inside an
 * `eachPlayer`, `loop`, `sequence` or `repeat` therefore kept waiting on the
 * next action step: every host reported `isComplete: false` beside a winner,
 * and players could keep acting in a game that was over.
 *
 * The flow engine is the one place that decides completion, so these drive the
 * real `GameRunner` over every construct that can hold an action step, ending
 * the game both ways it can be ended.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  sequence,
  repeat,
  forEach,
  phase,
  actionStep,
  simultaneousActionStep,
  turnLoop,
  stateAwareLoop,
  execute,
  type FlowNode,
  type GameOptions,
} from '../index.js';
import { GameRunner } from '../../runtime/runner.js';

class EndingGame extends Game<EndingGame, Player> {
  /** Every node and action that ran, in order, so a test can see what ran after the end. */
  ran: string[] = [];

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<EndingGame>('pass').prompt('Pass').execute((_a, ctx) => {
        (ctx.game as EndingGame).ran.push(`pass:${ctx.player.seat}`);
      }),
      // Ends the game the way an action's own rules do: `this.finish([...])`.
      Action.create<EndingGame>('win').prompt('Win').execute((_a, ctx) => {
        const game = ctx.game as EndingGame;
        game.ran.push(`win:${ctx.player.seat}`);
        game.finish([ctx.player]);
      }),
      // Ends the game and still asks for a follow-up, which must not be offered.
      Action.create<EndingGame>('winThenPass').prompt('Win, then pass').execute((_a, ctx) => {
        const game = ctx.game as EndingGame;
        game.ran.push(`winThenPass:${ctx.player.seat}`);
        game.finish([ctx.player]);
        return { success: true, followUp: { action: 'pass' } };
      }),
    );
  }
}

const ACTIONS = ['pass', 'win', 'winThenPass'];

function start(root: FlowNode<EndingGame>, playerCount = 3): GameRunner<EndingGame> {
  const runner = new GameRunner({
    GameClass: EndingGame,
    gameType: 'ending',
    gameOptions: { playerCount, seed: 'finish-ends-flow' },
  });
  runner.game.setFlow(defineFlow({ root }));
  runner.start();
  return runner;
}

/** The game is over everywhere a host reads it: complete, nobody prompted, winners set. */
function expectOver(runner: GameRunner<EndingGame>, winners: number[]): void {
  const state = runner.getFlowState()!;
  expect(runner.isComplete()).toBe(true);
  expect(state.complete).toBe(true);
  expect(state.awaitingInput).toBe(false);
  expect(state.currentPlayer).toBeUndefined();
  expect(state.availableActions).toBeUndefined();
  expect(state.awaitingPlayers).toBeUndefined();
  expect(state.followUps).toBeUndefined();
  expect(runner.getWinners().map((p) => p.seat)).toEqual(winners);
  // The snapshot every host stores and the view every seat receives agree.
  expect(runner.getSnapshot().flowState?.complete).toBe(true);
  for (const seat of [1, 2]) {
    const view = runner.getPlayerView(seat);
    expect(view.complete).toBe(true);
    expect(view.winners).toEqual(winners);
  }
}

/** No seat can act once the game is over. */
function expectNoFurtherActions(runner: GameRunner<EndingGame>): void {
  const before = [...runner.game.ran];
  for (const seat of [1, 2, 3]) {
    expect(runner.performAction('pass', seat, {}).success).toBe(false);
  }
  expect(runner.game.ran).toEqual(before);
}

const step = () => actionStep<EndingGame>({ actions: ACTIONS, turnScope: 'restart' });

/** Every construct that can hold the action step the game ends in. */
const constructs: Array<[string, () => FlowNode<EndingGame>]> = [
  ['eachPlayer', () => eachPlayer({ do: step() })],
  ['loop', () => loop({ maxIterations: 50, do: eachPlayer({ do: step() }) })],
  ['unbounded loop with no while', () => loop({ unbounded: true, do: step() })],
  ['sequence', () => sequence(step(), step(), step())],
  ['repeat', () => repeat(5, step())],
  ['forEach', () => forEach({ collection: [1, 2, 3], as: 'n', do: step() })],
  ['phase', () => phase('main', { do: sequence(step(), step()) })],
  ['turnLoop', () => turnLoop({ actions: ACTIONS, turnScope: 'restart' })],
  ['stateAwareLoop', () => stateAwareLoop({ actions: ACTIONS, turnScope: 'restart' })],
  [
    'actionStep that keeps the seat acting',
    () => actionStep({ actions: ACTIONS, repeatUntil: () => false, turnScope: 'continue' }),
  ],
];

describe('a game finished inside any flow construct is complete', () => {
  for (const [name, build] of constructs) {
    describe(name, () => {
      it('ends the flow when an action calls finish()', () => {
        const runner = start(build());
        expect(runner.isComplete()).toBe(false);

        expect(runner.performAction('win', 1, {}).success).toBe(true);

        expectOver(runner, [1]);
        expectNoFurtherActions(runner);
      });

      it('offers no follow-up an action that finished the game asked for', () => {
        const runner = start(build());

        expect(runner.performAction('winThenPass', 1, {}).success).toBe(true);

        expectOver(runner, [1]);
        expectNoFurtherActions(runner);
      });

      it('stays open while the game is not finished', () => {
        const runner = start(build());
        expect(runner.performAction('pass', 1, {}).success).toBe(true);
        expect(runner.isComplete()).toBe(false);
        expect(runner.getFlowState()!.awaitingInput).toBe(true);
      });
    });
  }
});

describe('a simultaneous step', () => {
  const build = () =>
    loop<EndingGame>({ maxIterations: 10, do: simultaneousActionStep({ actions: ACTIONS }) });

  it('ends the flow when one seat finishes the game while others are still to act', () => {
    const runner = start(build());
    expect(runner.getFlowState()!.awaitingPlayers?.length).toBe(3);

    expect(runner.performAction('win', 2, {}).success).toBe(true);

    expectOver(runner, [2]);
    expectNoFurtherActions(runner);
  });

  it('admits no seat when the awaiting set is refreshed after the game is over', () => {
    const runner = start(build());
    runner.performAction('win', 2, {});

    runner.game.refreshAwaitingActions();

    expectOver(runner, [2]);
  });

});

describe('a game finished by a flow node rather than an action', () => {
  it('runs nothing after the node that finished it', () => {
    const runner = start(
      sequence(
        step(),
        execute<EndingGame>((ctx) => {
          ctx.game.ran.push('final-execute');
          ctx.game.finish([ctx.game.getPlayer(3)!]);
        }),
        execute<EndingGame>((ctx) => { ctx.game.ran.push('after-finish'); }),
        step(),
      ),
    );

    runner.performAction('pass', 1, {});

    expectOver(runner, [3]);
    expect(runner.game.ran).toEqual(['pass:1', 'final-execute']);
  });

  it('a game finished during start() never opens a step', () => {
    const runner = start(
      sequence(
        execute<EndingGame>((ctx) => ctx.game.finish([ctx.game.getPlayer(2)!])),
        eachPlayer({ do: step() }),
      ),
    );

    expectOver(runner, [2]);
    expectNoFurtherActions(runner);
  });
});

/** The same game with its flow fixed in the constructor, as a restore rebuilds it. */
class EachPlayerEndingGame extends EndingGame {
  constructor(options: GameOptions) {
    super(options);
    this.setFlow(defineFlow({ root: eachPlayer<EndingGame>({ do: step() }) }));
  }
}

describe('a finished game restored from its snapshot', () => {
  it('is still complete and still refuses actions', () => {
    const runner = new GameRunner({
      GameClass: EachPlayerEndingGame,
      gameType: 'ending',
      gameOptions: { playerCount: 3, seed: 'finish-ends-flow' },
    });
    runner.start();
    runner.performAction('win', 1, {});

    const restored = GameRunner.fromSnapshot(runner.getSnapshot(), EachPlayerEndingGame);

    expect(restored.isComplete()).toBe(true);
    expect(restored.getWinners().map((p) => p.seat)).toEqual([1]);
    expect(restored.performAction('pass', 2, {}).success).toBe(false);
  });
});
