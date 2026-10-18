/**
 * Catches in the engine around game code use the shared crash handling (#1045, #1120): a
 * PlayerFacingError travels verbatim and uncoded; anything else is logged once, coded as a crash
 * where the result has the flag, and replaced by the shared sentence, its own text added only
 * where dev throwing is on.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, Player, Action, PlayerFacingError, FlowHaltedError } from './index.js';
import { ActionExecutor } from './action/action.js';
import { rulesErrorSentence } from './action/rules-error.js';

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
  return { result, loggedTimes: log.mock.calls.filter((call) => call.includes(thrown)).length };
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

  it("passes a PlayerFacingError's sentence verbatim and uncoded", () => {
    devThrow.enabled = false;
    const { result } = run(site, new PlayerFacingError(REFUSAL));
    expect(result.error).toBe(REFUSAL);
    expect(result.rulesError).toBeUndefined();
  });
});

it('a crash in onSelect through executeAction is coded as one (#847, #1120)', () => {
  devThrow.enabled = false;
  expect(run(sites['onSelect in executeAction'], new TypeError(SECRET)).result.rulesError).toBe(true);
});

describe('FlowHaltedError (#1120)', () => {
  it('tells a deployed player the flow halted without the thrown text, and logs the cause once', () => {
    devThrow.enabled = false;
    const cause = new Error(SECRET);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const halted = new FlowHaltedError(cause);
    expect(halted.message).toContain('Game halted');
    expect(halted.message).not.toContain(SECRET);
    expect(log.mock.calls.filter((call) => call.includes(cause))).toHaveLength(1);
  });

  it('adds the thrown text for the author where dev throwing is on', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(new FlowHaltedError(new Error(SECRET)).message).toContain(`(${SECRET})`);
  });
});
