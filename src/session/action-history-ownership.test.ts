/**
 * One owner for the action history, and one place that stamps time on it
 * (#48, #54).
 *
 * `runner.actionHistory` is the array. `#storedState.actionHistory` used to be
 * kept alongside it by a mix of reference assignment (after an action) and
 * spread copies (on the HMR restore paths), and the five places that swap in a
 * replacement runner each re-pointed some subset of the session's references.
 * Whether `getHistory()` served the live array or a detached copy therefore
 * depended on which path happened to run last.
 *
 * The invariant these tests pin: after ANY operation, the array `getHistory()`
 * serves is the array the current runner is appending to.
 *
 * Timestamps are the session's, not the engine's (#54): the engine records no
 * clock reading, so two runs of a seed are byte-identical, and the session
 * stamps arrival time onto the history it hands out.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, eachPlayer, type GameOptions } from '../engine/index.js';
import { GameSession } from './game-session.js';
import type { GameDefinition } from './types.js';

class CounterGame extends Game<CounterGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('bump').prompt('Bump').execute(() => {}));
    this.setFlow(
      defineFlow({
        root: loop({
          while: () => true,
          maxIterations: 50,
          do: eachPlayer({ do: actionStep({ actions: ['bump'] }) }),
        }),
      })
    );
  }
}

const definition: GameDefinition = {
  gameType: 'counter',
  gameClass: CounterGame,
  minPlayers: 2,
  maxPlayers: 2,
};

function makeSession() {
  return GameSession.create({
    gameType: 'counter',
    GameClass: CounterGame,
    playerCount: 2,
    playerNames: ['Alice', 'Bob'],
    seed: 'history',
  });
}

/**
 * The invariant: the runner owns the array, the stored state holds a VIEW of
 * that same array (never a copy that can go stale), and what `getHistory()`
 * serves corresponds entry-for-entry to what the runner has recorded.
 */
function expectSingleOwner(session: ReturnType<typeof makeSession>) {
  expect(session.storedState.actionHistory).toBe(session.runner.actionHistory);
  const served = session.getHistory().actionHistory;
  expect(served.map(e => `${e.name}/${e.player}`)).toEqual(
    session.runner.actionHistory.map(e => `${e.name}/${e.player}`)
  );
}

describe('action history has one owner (#48)', () => {
  it('serves the runner\'s live array from the moment the session exists', () => {
    expectSingleOwner(makeSession());
  });

  it('still serves the runner\'s live array after actions are recorded', async () => {
    const session = makeSession();
    await session.performAction('bump', 1, {});
    await session.performAction('bump', 2, {});
    expect(session.getHistory().actionHistory).toHaveLength(2);
    expectSingleOwner(session);
  });

  it('re-points at the replacement runner when a hot reload swaps one in', async () => {
    const session = makeSession();
    await session.performAction('bump', 1, {});

    session.reloadWithCurrentRules(definition);

    // The pre-fix bug: the session kept serving the OLD runner's array, so a
    // later action landed somewhere getHistory() could not see.
    expectSingleOwner(session);
    await session.performAction('bump', 2, {});
    expect(session.getHistory().actionHistory).toHaveLength(2);
    expectSingleOwner(session);
  });

  it('re-points at the replacement runner after an undo', async () => {
    const session = makeSession();
    await session.performAction('bump', 1, {});
    await session.performAction('bump', 2, {});
    await session.undoToTurnStart(2);
    expectSingleOwner(session);
  });
});

describe('the session stamps history time, the engine does not (#54)', () => {
  it('gives every entry it serves a wall-clock timestamp', async () => {
    const before = Date.now();
    const session = makeSession();
    await session.performAction('bump', 1, {});
    const after = Date.now();

    const [entry] = session.getHistory().actionHistory;
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
  });

  it('keeps the engine\'s own snapshot free of the clock reading', async () => {
    const session = makeSession();
    await session.performAction('bump', 1, {});

    const snapshot = session.runner.getSnapshot();
    for (const entry of snapshot.actionHistory) {
      expect(entry.timestamp).toBeUndefined();
    }
  });

  it('stamps each entry once — a later action does not restamp earlier ones', async () => {
    const session = makeSession();
    await session.performAction('bump', 1, {});
    const firstStamp = session.getHistory().actionHistory[0].timestamp;

    await session.performAction('bump', 2, {});
    expect(session.getHistory().actionHistory[0].timestamp).toBe(firstStamp);
    expect(session.getHistory().actionHistory[1].timestamp).toBeDefined();
  });
});
