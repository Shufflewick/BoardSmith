/**
 * Catches in the engine around game code use the shared crash handling (#1045, #1120): a
 * PlayerFacingError travels verbatim and uncoded; anything else is logged once, coded as a crash
 * where the result has the flag, and replaced by the shared sentence, its own text added only
 * where dev throwing is on.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Game,
  Player,
  Action,
  PlayerFacingError,
  NotSimulableError,
  FlowHaltedError,
  sequence,
  loop,
  actionStep,
  execute,
  type GameOptions,
} from './index.js';
import { ActionExecutor } from './action/action.js';
import { rulesErrorSentence } from './action/rules-error.js';
import { enumerateActionMoves } from './utils/enumerate-moves.js';
import { GameRunner } from '../runtime/runner.js';

// Lets a test run as a deployed host does, where no dev detail travels (#1045).
const devThrow = vi.hoisted(() => ({ enabled: true }));
vi.mock('../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/dev.js')>();
  return { ...actual, isDevThrowEnabled: () => devThrow.enabled };
});

class TestGame extends Game<TestGame, Player> {}

const SECRET = "Cannot read properties of undefined (reading 'suit')";
const REFUSAL = 'The well is dry this round.';

type Thrower = () => never;
type Outcome = { error?: string; rulesError?: boolean };

/** Each site runs `thrower` as the game code it guards, in an action named 'act', and returns its result. */
const sites: Record<string, (thrower: Thrower) => Outcome> = {
  'onSelect in executeAction': (thrower) => {
    const { executor, player } = setup();
    const action = Action.create('act').chooseFrom('pick', { choices: ['a'], onSelect: thrower }).execute(() => {});
    return executor.executeAction(action, player, { pick: 'a' });
  },
  'onSelect in processSelectionStep': (thrower) => {
    const { executor, player } = setup();
    const action = Action.create('act').chooseFrom('pick', { choices: ['a'], onSelect: thrower }).execute(() => {});
    return executor.processSelectionStep(action, player, executor.createPendingActionState('act', 1), 'pick', 'a');
  },
  'onSelect in processRepeatingStep': (thrower) => {
    const { executor, player } = setup();
    const action = Action.create('act')
      .chooseFrom('items', { choices: ['a', 'done'], repeatUntil: 'done', onSelect: thrower })
      .execute(() => {});
    return executor.processRepeatingStep(action, player, executor.createPendingActionState('act', 1), 'a');
  },
  'repeat onEach': (thrower) => {
    const { executor, player } = setup();
    const action = Action.create('act')
      .chooseFrom('items', { choices: ['a', 'done'], repeat: { onEach: thrower, until: () => false } })
      .execute(() => {});
    return executor.processRepeatingStep(action, player, executor.createPendingActionState('act', 1), 'a');
  },
  'repeat until': (thrower) => {
    const { executor, player } = setup();
    const action = Action.create('act')
      .chooseFrom('items', { choices: ['a', 'done'], repeat: { until: thrower } })
      .execute(() => {});
    return executor.processRepeatingStep(action, player, executor.createPendingActionState('act', 1), 'a');
  },
};

function setup() {
  const game = new TestGame({ playerCount: 2 });
  return { executor: new ActionExecutor(game), player: game.getPlayer(1)! };
}

/** Runs `site` with `thrown` thrown from its game code, and what the error log received. */
function run(site: (thrower: Thrower) => Outcome, thrown: Error) {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = site(() => { throw thrown; });
  return { result, loggedTimes: log.mock.calls.filter((call) => call.includes(thrown)).length, logged: log.mock.calls.length };
}

afterEach(() => {
  devThrow.enabled = true;
  vi.restoreAllMocks();
});

describe.each(Object.entries(sites))('%s (#1120)', (_name, site) => {
  it('tells a deployed player the shared sentence, never the thrown text, and logs the throw once', () => {
    devThrow.enabled = false;
    const thrown = new Error(SECRET);
    const { result, loggedTimes } = run(site, thrown);
    expect(result.error).toBe(rulesErrorSentence('act'));
    expect(loggedTimes).toBe(1);
  });

  it('adds the thrown text for the author where dev throwing is on', () => {
    const { result } = run(site, new Error(SECRET));
    expect(result.error).toBe(`${rulesErrorSentence('act')} (${SECRET})`);
  });

  it("passes a PlayerFacingError's sentence verbatim, uncoded and unlogged", () => {
    devThrow.enabled = false;
    const { result, logged } = run(site, new PlayerFacingError(REFUSAL));
    expect(result.error).toBe(REFUSAL);
    expect(result.rulesError).toBeUndefined();
    expect(logged).toBe(0);
  });

  it('passes a NotSimulableError on unlogged, as a search answer and not a crash (#31)', () => {
    const { result, logged } = run(site, new NotSimulableError('needs the hidden map'));
    expect(result.error).toBe('needs the hidden map');
    expect(result.rulesError).toBeUndefined();
    expect(logged).toBe(0);
  });
});

it('a crash in onSelect through executeAction is coded as one, and a NotSimulableError as not simulable (#847, #1120)', () => {
  devThrow.enabled = false;
  expect(run(sites['onSelect in executeAction'], new TypeError(SECRET)).result.rulesError).toBe(true);
  expect(run(sites['onSelect in executeAction'], new NotSimulableError('hidden')).result).toMatchObject({ notSimulable: true });
});

it('names the hook and the pick in the log (#1120)', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  sites['repeat onEach'](() => { throw new Error(SECRET); });
  expect(String(log.mock.calls[0][0])).toContain("onEach of 'items' in action 'act'");
});

it('listing moves through an onSelect or onEach that refuses values in words logs nothing (#31, #1120)', () => {
  const refuseB = (value: unknown) => {
    if (value === 'b') throw new PlayerFacingError(REFUSAL);
  };
  class RefusingGame extends Game<Game, Player> {
    constructor(options: GameOptions) {
      super(options);
      this.registerActions(
        Action.create('onSelectRefuses').chooseFrom('pick', { choices: ['a', 'b'], onSelect: refuseB }).execute(() => {}),
        Action.create('onEachRefuses')
          .chooseFrom('items', { choices: ['a', 'b', 'done'], repeat: { onEach: (_ctx, value) => refuseB(value), until: () => true } })
          .execute(() => {}),
      );
    }
  }
  const game = new RefusingGame({ playerCount: 2, seed: 'refuse' });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const name of ['onSelectRefuses', 'onEachRefuses']) {
    expect(enumerateActionMoves(game, game.getAction(name)!, game.getPlayer(1)!)).not.toEqual([]);
  }
  expect(log).not.toHaveBeenCalled();
});

/** A game whose flow throws `halt()` in the step after its one action commits. */
function haltingGame(halt: () => Error) {
  return class HaltingGame extends Game<Game, Player> {
    constructor(options: GameOptions) {
      super(options);
      this.registerActions(Action.create('go').prompt('Go').execute(() => {}));
      this.setFlow({
        root: loop({
          maxIterations: 5,
          do: sequence(
            actionStep({ player: (ctx) => ctx.game.getPlayer(1)!, actions: ['go'] }),
            execute(() => { throw halt(); }),
          ),
        }),
      });
    }
  };
}

describe('FlowHaltedError (#1120)', () => {
  it('tells a deployed player the flow halted without the thrown text, and the runner logs the cause once', () => {
    devThrow.enabled = false;
    const cause = new Error(SECRET);
    const runner = new GameRunner({ GameClass: haltingGame(() => cause), gameType: 'halt', gameOptions: { playerCount: 2, seed: 'halt' } });
    runner.start();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = runner.performAction('go', 1, {});
    expect(result.success).toBe(false);
    expect(result.error).toBe(new FlowHaltedError(cause).message);
    expect(result.error).not.toContain(SECRET);
    expect(log.mock.calls.filter((call) => call.includes(cause))).toHaveLength(1);
  });

  it('the runner logs a NotSimulableError cause too, since a live game that halts on one has really halted', () => {
    const cause = new NotSimulableError('needs the hidden map');
    const runner = new GameRunner({ GameClass: haltingGame(() => cause), gameType: 'halt', gameOptions: { playerCount: 2, seed: 'halt' } });
    runner.start();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(runner.performAction('go', 1, {}).success).toBe(false);
    expect(log.mock.calls.filter((call) => call.includes(cause))).toHaveLength(1);
  });

  it('creating a halt logs nothing, so a search copy that halts on hidden state stays quiet (#31)', () => {
    const HaltingGame = haltingGame(() => new NotSimulableError('needs the hidden map'));
    const game = new HaltingGame({ playerCount: 2, seed: 'halt' });
    game.startFlow();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => game.continueFlow('go', {}, 1)).toThrow(FlowHaltedError);
    expect(log).not.toHaveBeenCalled();
  });

  it('adds the thrown text for the author where dev throwing is on', () => {
    expect(new FlowHaltedError(new Error(SECRET)).message).toContain(`(${SECRET})`);
  });
});
