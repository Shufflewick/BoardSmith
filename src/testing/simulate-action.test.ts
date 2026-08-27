/**
 * The `boardsmith/testing` action-simulation surface that games write their own
 * tests against: `simulateAction`, `simulateActions`, `assertActionSucceeds`,
 * `assertActionFails`, and the `ActionExecutionError` `doAction` throws.
 * `play-until-complete.test.ts` covers the loop driver in the same module.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
  type FlowContext,
} from '../engine/index.js';
import { TestGame, ActionExecutionError } from './test-game.js';
import {
  simulateAction,
  simulateActions,
  assertActionSucceeds,
  assertActionFails,
} from './simulate-action.js';

/** Players alternate adding 1-3 to a shared total; the game ends at 6. */
class PickGame extends Game<PickGame, Player> {
  total = 0;

  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create<PickGame>('pick')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .execute((args, ctx) => {
          ctx.game.total += args.value as number;
          return { success: true };
        }),
    );

    this.registerAction(
      Action.create<PickGame>('cheat')
        .chooseFrom('value', { choices: [1, 2, 3] })
        .validate(() => 'cheating is not allowed')
        .execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: (ctx) => ctx.game.total < 6,
          maxIterations: 100,
          do: eachPlayer({ do: actionStep({ actions: ['pick', 'cheat'] }) }),
        }),
      }),
    );
  }
}

const newGame = () => TestGame.create(PickGame, { playerCount: 2 });

describe('simulateAction', () => {
  it('performs the action and reports success', () => {
    const testGame = newGame();
    const result = simulateAction(testGame, 1, 'pick', { value: 2 });
    expect(result.success).toBe(true);
    expect(testGame.game.total).toBe(2);
  });

  it('echoes back what was attempted, so a failed assertion is self-describing', () => {
    const result = simulateAction(newGame(), 1, 'pick', { value: 3 });
    expect(result.action).toBe('pick');
    expect(result.playerSeat).toBe(1);
    expect(result.args).toEqual({ value: 3 });
  });

  it('returns a failed result instead of throwing when the action is rejected', () => {
    const testGame = newGame();
    const result = simulateAction(testGame, 1, 'cheat', { value: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('cheating is not allowed');
    expect(testGame.game.total).toBe(0);
  });

  it('returns a failed result for the wrong seat rather than throwing', () => {
    const result = simulateAction(newGame(), 2, 'pick', { value: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns a failed result for an action that does not exist', () => {
    const result = simulateAction(newGame(), 1, 'noSuchAction', {});
    expect(result.success).toBe(false);
    expect(result.action).toBe('noSuchAction');
  });

  it('defaults args to an empty object', () => {
    const result = simulateAction(newGame(), 1, 'pick');
    expect(result.args).toEqual({});
  });
});

describe('simulateActions', () => {
  it('runs the actions in order and returns one result each', () => {
    const testGame = newGame();
    const results = simulateActions(testGame, [
      [1, 'pick', { value: 2 }],
      [2, 'pick', { value: 3 }],
    ]);
    expect(results.map((r) => r.success)).toEqual([true, true]);
    expect(testGame.game.total).toBe(5);
  });

  it('labels each result with the seat and action that produced it', () => {
    const results = simulateActions(newGame(), [
      [1, 'pick', { value: 1 }],
      [2, 'pick', { value: 1 }],
    ]);
    expect(results.map((r) => [r.playerSeat, r.action])).toEqual([[1, 'pick'], [2, 'pick']]);
  });

  it('keeps going after a failure and reports it in place', () => {
    const testGame = newGame();
    const results = simulateActions(testGame, [
      [1, 'pick', { value: 1 }],
      [1, 'pick', { value: 1 }], // out of turn — seat 2 is up
      [2, 'pick', { value: 1 }],
    ]);
    expect(results.map((r) => r.success)).toEqual([true, false, true]);
    expect(testGame.game.total).toBe(2);
  });

  it('treats an omitted args tuple slot as no arguments', () => {
    const results = simulateActions(newGame(), [[1, 'pick']]);
    expect(results[0].args).toEqual({});
  });

  it('returns an empty array for an empty script', () => {
    expect(simulateActions(newGame(), [])).toEqual([]);
  });
});

describe('assertActionSucceeds', () => {
  it('returns the result when the action succeeds', () => {
    const result = assertActionSucceeds(newGame(), 1, 'pick', { value: 2 });
    expect(result.success).toBe(true);
    expect(result.action).toBe('pick');
  });

  it('applies the action, it does not merely check it', () => {
    const testGame = newGame();
    assertActionSucceeds(testGame, 1, 'pick', { value: 3 });
    expect(testGame.game.total).toBe(3);
  });

  it('throws naming the action, the seat and the engine reason', () => {
    expect(() => assertActionSucceeds(newGame(), 1, 'cheat', { value: 1 }))
      .toThrow(/action 'cheat' by player 1 to succeed.*cheating is not allowed/s);
  });

  it('throws when the seat is not the one to act', () => {
    expect(() => assertActionSucceeds(newGame(), 2, 'pick', { value: 1 }))
      .toThrow(/to succeed, but it failed/);
  });
});

describe('assertActionFails', () => {
  it('returns the failed result when the action is rejected', () => {
    const result = assertActionFails(newGame(), 1, 'cheat', { value: 1 });
    expect(result.success).toBe(false);
  });

  it('leaves the game untouched', () => {
    const testGame = newGame();
    assertActionFails(testGame, 1, 'cheat', { value: 1 });
    expect(testGame.game.total).toBe(0);
  });

  it('throws when the action unexpectedly succeeds', () => {
    expect(() => assertActionFails(newGame(), 1, 'pick', { value: 1 }))
      .toThrow(/action 'pick' by player 1 to fail, but it succeeded/);
  });

  it('accepts a substring the error must contain', () => {
    expect(() => assertActionFails(newGame(), 1, 'cheat', { value: 1 }, 'cheating'))
      .not.toThrow();
  });

  it('accepts a regex the error must match', () => {
    expect(() => assertActionFails(newGame(), 1, 'cheat', { value: 1 }, /not allowed$/))
      .not.toThrow();
  });

  it('throws when the action fails for a different reason than expected', () => {
    expect(() => assertActionFails(newGame(), 1, 'cheat', { value: 1 }, 'out of turn'))
      .toThrow(/Expected error to match out of turn, but got: .*cheating is not allowed/s);
  });

  it('reports the actual error when a regex does not match', () => {
    expect(() => assertActionFails(newGame(), 1, 'cheat', { value: 1 }, /^nothing like it$/))
      .toThrow(/but got: /);
  });
});

describe('ActionExecutionError', () => {
  const failingCall = (testGame: TestGame<PickGame>) => () =>
    testGame.doAction(1, 'cheat', { value: 1 });

  it('is what doAction throws on a failed action', () => {
    expect(failingCall(newGame())).toThrow(ActionExecutionError);
  });

  it('is identifiable by name without an instanceof check', () => {
    try {
      failingCall(newGame())();
      expect.unreachable('doAction should have thrown');
    } catch (error) {
      expect((error as Error).name).toBe('ActionExecutionError');
    }
  });

  it('carries the action, seat and args that failed', () => {
    try {
      newGame().doAction(1, 'cheat', { value: 2 });
      expect.unreachable('doAction should have thrown');
    } catch (error) {
      const failure = error as ActionExecutionError;
      expect(failure.actionName).toBe('cheat');
      expect(failure.playerSeat).toBe(1);
      expect(failure.args).toEqual({ value: 2 });
    }
  });

  it('carries the raw failed result for programmatic inspection', () => {
    try {
      failingCall(newGame())();
      expect.unreachable('doAction should have thrown');
    } catch (error) {
      const failure = error as ActionExecutionError;
      expect(failure.result.success).toBe(false);
      expect(failure.result.error).toContain('cheating is not allowed');
    }
  });

  it('explains the failure in its message', () => {
    expect(failingCall(newGame())).toThrow(/cheat/);
  });

  it('is a real Error, so a bare catch still gets a stack', () => {
    try {
      failingCall(newGame())();
      expect.unreachable('doAction should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).stack).toBeTruthy();
    }
  });

  it('is not thrown by tryAction, which reports failure as a value', () => {
    const testGame = newGame();
    expect(() => testGame.tryAction(1, 'cheat', { value: 1 })).not.toThrow();
    expect(testGame.tryAction(1, 'cheat', { value: 1 }).success).toBe(false);
  });
});
