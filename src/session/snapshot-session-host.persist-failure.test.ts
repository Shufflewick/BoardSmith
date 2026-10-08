/**
 * A failing `persist` adapter never stops play (ERR-03, T-126-04).
 *
 * A storage failure is the platform's problem to report, not the game's: the
 * move it failed to save has already happened, the table carries on, and the
 * failure is reported through `onPersistenceError` / `lastPersistenceError`
 * and nowhere else. In particular a save that fails while a bot is moving is
 * not a bot failure. The host's ordinary persistence-health cases (counter,
 * threshold, recovery) live in snapshot-session-host.test.ts.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Game, Player, Action, defineFlow, actionStep, loop, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { SnapshotSessionHost, type SnapshotSessionAdapters } from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Seat 2 is to move first and once; a bot plays it. */
class BotActsFirstGame extends Game<BotActsFirstGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('move').execute(() => ({ success: true })));
    this.setFlow(defineFlow({
      root: actionStep({ actions: ['move'], player: (ctx) => ctx.game.getPlayer(2)! }),
    }));
  }
}

/** Seat 1 repeats a no-op move, so one test can drive several saves. */
class RepeatMoveGame extends Game<RepeatMoveGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('move').execute(() => ({ success: true })));
    this.setFlow(defineFlow({
      root: loop({
        maxIterations: 100,
        do: actionStep({ actions: ['move'], player: (ctx) => ctx.game.getPlayer(1)!, turnScope: 'restart' }),
      }),
    }));
  }
}

function hostFor(def: GameDefinitionLike, extra: Partial<SnapshotSessionAdapters>) {
  const gameOptions = { playerCount: 2, seed: 'persist-failure' };
  return new SnapshotSessionHost({
    playerCount: 2,
    executeOp: (snap, pend, op) => executeOp(def, gameOptions, snap, pend, op),
    record: () => {},
    push: () => {},
    ...extra,
  });
}

describe('a failing persist adapter never stops play', () => {
  it('a save that fails during a bot turn is reported as a persistence error, the bot move still lands, and no bot failure is logged', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const persistenceErrors: string[] = [];
    const host = hostFor(
      { gameClass: BotActsFirstGame, gameType: 'bot-acts-first', minPlayers: 2, maxPlayers: 2 },
      {
        persist: async () => {
          throw new Error('disk full');
        },
        onPersistenceError: (error) => {
          persistenceErrors.push(error.message);
        },
      },
    );
    host.setBotSeats([{ seat: 2, level: 'easy' }]);
    await host.start();

    await host.runBotTurns();

    expect(host.isComplete).toBe(true);
    expect(persistenceErrors.length).toBeGreaterThan(0);
    expect(persistenceErrors.every((m) => m === 'disk full')).toBe(true);
    expect(host.lastPersistenceError?.message).toBe('disk full');
    // Every console error is the persistence report, never a bot giving up.
    const logged = consoleError.mock.calls.map((c) => String(c[0]));
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.every((m) => m.includes('persist failed'))).toBe(true);
  });

  it('an onPersistenceError hook that itself throws is swallowed, and the move still lands', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = hostFor(
      { gameClass: RepeatMoveGame, gameType: 'repeat-move', minPlayers: 2, maxPlayers: 2 },
      {
        persist: async () => {
          throw new Error('disk full');
        },
        onPersistenceError: () => {
          throw new Error('hook exploded');
        },
      },
    );
    await host.start();

    const result = await host.handleOp(1, {
      type: 'action', actionName: 'move', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(host),
    });

    expect(result.success).toBe(true);
    expect(host.lastPersistenceError?.message).toBe('disk full');
  });
});
