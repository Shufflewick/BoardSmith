/**
 * How a game's own tests run an action and check its outcome:
 * `assertActionFails`, and the `ActionExecutionError` `doAction` throws.
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
import { assertActionFails } from './assertions.js';

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
