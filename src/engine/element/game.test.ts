/**
 * PIT-03 unit coverage for Game#validateActionReachability() (called from
 * startFlow() before FlowEngine construction).
 *
 * - Throw case: an actionStep references an unregistered action (static
 *   string-array form).
 * - devWarn case: a registered action referenced by no actionStep.
 * - Positive case: a correctly-wired game starts clean (no throw, no warn).
 * - Function-valued-actions blind spot: actions field is a function, so it
 *   cannot be statically enumerated and must never throw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../index.js';
import { _clearShownWarnings } from '../../utils/dev.js';

class MissingActionGame extends Game<MissingActionGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    // Only 'known' is registered; the flow also references 'missing'.
    this.registerAction(
      Action.create<MissingActionGame>('known').execute(() => {}),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 5,
          do: eachPlayer({
            do: actionStep({ actions: ['known', 'missing'] }),
          }),
        }),
      }),
    );
  }
}

class UnreachableActionGame extends Game<UnreachableActionGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    // 'used' is referenced by the actionStep; 'unused' is registered but
    // never referenced by any actionStep.
    this.registerAction(
      Action.create<UnreachableActionGame>('used').execute(() => {}),
    );
    this.registerAction(
      Action.create<UnreachableActionGame>('unused').execute(() => {}),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 5,
          do: eachPlayer({
            do: actionStep({ actions: ['used'] }),
          }),
        }),
      }),
    );
  }
}

class CorrectlyWiredGame extends Game<CorrectlyWiredGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create<CorrectlyWiredGame>('draw').execute(() => {}),
    );
    this.registerAction(
      Action.create<CorrectlyWiredGame>('play').execute(() => {}),
    );
    this.setFlow(
      defineFlow({
        root: loop({
          maxIterations: 5,
          do: eachPlayer({
            do: actionStep({ actions: ['draw', 'play'] }),
          }),
        }),
      }),
    );
  }
}

class FunctionValuedActionsGame extends Game<FunctionValuedActionsGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    // Note: 'x' is deliberately unregistered — the function-valued `actions`
    // field is a static-walk blind spot (documented in
    // Game#validateActionReachability) and must never throw.
    // No outer loop() wrapper: a single eachPlayer pass with zero available
    // actions per player auto-completes the flow, avoiding an unrelated
    // loop-maxIterations safety error that would otherwise mask the
    // assertion this test cares about.
    this.setFlow(
      defineFlow({
        root: eachPlayer({
          do: actionStep({ actions: () => ['x'] }),
        }),
      }),
    );
  }
}

function makeOptions(): GameOptions {
  return {
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'pit-03-test',
  };
}

describe('PIT-03', () => {
  beforeEach(() => {
    _clearShownWarnings();
  });

  it('throws naming the unregistered action referenced by an actionStep', () => {
    const game = new MissingActionGame(makeOptions());
    expect(() => game.startFlow()).toThrowError(/missing/);
    expect(() => new MissingActionGame(makeOptions()).startFlow()).toThrowError(/registerActions/);
  });

  it('emits a devWarn (not a throw) for a registered action referenced by no actionStep', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const game = new UnreachableActionGame(makeOptions());

    expect(() => game.startFlow()).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unused'));

    warnSpy.mockRestore();
  });

  it('starts clean with no throw and no unreachable-action devWarn when correctly wired', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const game = new CorrectlyWiredGame(makeOptions());

    expect(() => game.startFlow()).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('does not throw when actionStep actions is a function (static-walk blind spot)', () => {
    const game = new FunctionValuedActionsGame(makeOptions());
    expect(() => game.startFlow()).not.toThrow();
  });
});
