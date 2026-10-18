/**
 * A refresh of the open simultaneous step made inside an action.
 *
 * #972: an action that refreshes the awaiting seats and then fails is rolled
 * back whole, the step's awaiting seats included, on every route the action
 * can take.
 *
 * #973: a refresh inside the acting seat's own action leaves that seat for the
 * action's settling to decide, so a pick-by-pick action whose onEach makes its
 * seat done settles the same as the action taken whole.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, simultaneousActionStep, sequence, execute, type GameOptions } from '../engine/index.js';
import { GameRunner } from './runner.js';
import { PendingActionManager } from '../session/pending-action-manager.js';

/** Makes seat 2 done and refreshes, so the refresh drops seat 2, then fails. */
function benchSeat2ThenThrow(game: WaitGame): never {
  game.done[2] = true;
  game.refreshAwaitingActions();
  throw new Error('rules bug after the refresh');
}

class WaitGame extends Game<WaitGame, Player> {
  done: Record<number, boolean> = {};
  afterRound = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<WaitGame>('benchThenFail').prompt('Bench seat 2, then fail').execute((_a, ctx) => benchSeat2ThenThrow(ctx.game)),
      Action.create<WaitGame>('pickThenFail')
        .prompt('Pick, bench seat 2, then fail')
        .chooseFrom('x', { choices: ['a'] })
        .execute((_a, ctx) => benchSeat2ThenThrow(ctx.game)),
      Action.create<WaitGame>('settle')
        .prompt('Settle')
        .chooseFrom('picks', {
          choices: ['x'],
          repeat: {
            until: () => true,
            onEach: (ctx) => {
              const game = ctx.game as WaitGame;
              game.done[ctx.player.seat] = true;
              game.refreshAwaitingActions();
            },
          },
        })
        .execute(() => {}),
    );
    this.setFlow({
      root: sequence(
        simultaneousActionStep({
          name: 'round',
          actions: ['benchThenFail', 'pickThenFail', 'settle'],
          playerDone: (ctx, player) => (ctx.game as WaitGame).done[player.seat] === true,
        }),
        execute<WaitGame>((ctx) => {
          ctx.game.afterRound++;
        }),
        simultaneousActionStep({ name: 'next', actions: ['settle'] }),
      ),
    });
  }
}

function started(): GameRunner<WaitGame> {
  const runner = new GameRunner({
    GameClass: WaitGame,
    gameType: 'wait',
    gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'wait' },
  });
  runner.start();
  return runner;
}

const awaiting = (runner: GameRunner<WaitGame>) => runner.getFlowState()?.awaitingPlayers;

describe('an action that refreshes the awaiting seats and then fails (#972)', () => {
  it('leaves the awaiting seats as they were, taken whole', () => {
    const runner = started();
    const before = awaiting(runner);

    expect(runner.performAction('benchThenFail', 1, {}).success).toBe(false);

    expect(runner.game.done).toEqual({});
    expect(awaiting(runner)).toEqual(before);
    expect(runner.performAction('settle', 2, { picks: ['x'] }).success).toBe(true);
  });

  it('leaves the awaiting seats as they were, taken pick by pick', () => {
    const runner = started();
    const before = awaiting(runner);

    runner.startPendingAction('pickThenFail', 1);
    expect(runner.processSelectionStep(1, 'x', 'a').success).toBe(false);

    expect(awaiting(runner)).toEqual(before);
  });

  it('leaves the awaiting seats as they were, through the session after a reload', async () => {
    const saved = started().getSnapshot();
    const runner = GameRunner.fromSnapshot(saved, WaitGame);
    const before = awaiting(runner);

    const step = await new PendingActionManager(runner, 2).processSelectionStep(1, 'x', 'a', 'pickThenFail');
    expect(step.success).toBe(false);
    expect(awaiting(runner)).toEqual(before);

    const reloaded = GameRunner.fromSnapshot(runner.getSnapshot(), WaitGame);
    expect(reloaded.performAction('benchThenFail', 1, {}).success).toBe(false);
    expect(awaiting(reloaded)).toEqual(before);
  });
});

describe("a pick-by-pick action whose onEach makes its own seat done and refreshes (#973)", () => {
  it('settles the same as the action taken whole', () => {
    const whole = started();
    expect(whole.performAction('settle', 1, { picks: ['x'] }).success).toBe(true);

    const byPick = started();
    byPick.startPendingAction('settle', 1);
    expect(byPick.processSelectionStep(1, 'picks', 'x')).toMatchObject({ success: true, actionComplete: true });

    expect(byPick.getFlowState()).toEqual(whole.getFlowState());
    expect(awaiting(byPick)).toEqual([
      { playerIndex: 1, availableActions: expect.any(Array), completed: true },
      { playerIndex: 2, availableActions: expect.any(Array), completed: false },
    ]);
  });

  it('runs the flow on once the other seat settles too', () => {
    const runner = started();
    runner.startPendingAction('settle', 1);
    runner.processSelectionStep(1, 'picks', 'x');
    runner.startPendingAction('settle', 2);

    expect(runner.processSelectionStep(2, 'picks', 'x').success).toBe(true);
    expect(runner.game.afterRound).toBe(1);
  });
});

/** An irreversible step, then a simultaneous step that never ends on its own. */
class FencedGame extends Game<FencedGame, Player> {
  taps = 0;

  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<FencedGame>('tap').prompt('Tap').execute((_a, ctx) => {
        ctx.game.taps++;
      }),
      Action.create<FencedGame>('tapThenFail').prompt('Tap, then fail').execute((_a, ctx) => {
        ctx.game.taps++;
        throw new Error('rules bug after the tap');
      }),
    );
    this.setFlow({
      root: sequence(
        execute<FencedGame>(() => {}, { irreversible: true }),
        simultaneousActionStep({ name: 'tapping', actions: ['tap', 'tapThenFail'], allDone: () => false }),
      ),
    });
  }
}

describe('a rollback inside the turn after an irreversible step (#972)', () => {
  it('leaves the undo fence where the irreversible step put it', () => {
    const runner = new GameRunner({
      GameClass: FencedGame,
      gameType: 'fenced',
      gameOptions: { playerCount: 2, playerNames: ['A', 'B'], seed: 'fenced' },
    });
    runner.start();
    runner.getSnapshot();
    const fence = runner.executeBarrierIndex;

    expect(runner.performAction('tap', 1, {}).success).toBe(true);
    runner.getSnapshot();
    expect(runner.performAction('tapThenFail', 1, {}).success).toBe(false);
    expect(runner.performAction('tap', 1, {}).success).toBe(true);
    runner.getSnapshot();

    expect(runner.game.taps).toBe(2);
    expect(runner.executeBarrierIndex).toBe(fence);
  });
});
