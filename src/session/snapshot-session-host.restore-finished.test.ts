/**
 * A host rebuilt from a finished game's persisted state publishes the game's
 * real outcome (#490).
 *
 * The steps are the issue's: play a game to its end, take `durableState()` and
 * the views last handed to `record`, restore a second host from them, then
 * `broadcastCurrent()` or `rosterChanged()`. The persisted state crosses a JSON
 * round trip, the way a Durable Object's storage hands it back.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, execute, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import {
  SnapshotSessionHost,
  type PublishMeta,
  type SnapshotHostState,
} from './snapshot-session-host.js';

/** A game whose flow ends inside start(), declaring `winnerSeats` the winners. */
function finishedGameDef(winnerSeats: number[]): GameDefinitionLike {
  class FinishedGame extends Game<FinishedGame, Player> {
    constructor(options: GameOptions) {
      super(options);
      this.registerAction(Action.create('noop').execute(() => ({ success: true })));
      this.setFlow(
        defineFlow({
          root: execute(() => {}),
          getWinners: (ctx) => winnerSeats.map((seat) => ctx.game.getPlayer(seat)!),
        }),
      );
    }
  }
  return { gameClass: FinishedGame, gameType: 'finished', minPlayers: 1, maxPlayers: 4 };
}

const options = { playerCount: 3, seed: 'bs490' };

function makeHost(def: GameDefinitionLike) {
  const records: Array<{ views: unknown[]; spectator: unknown; meta: PublishMeta }> = [];
  const host = new SnapshotSessionHost({
    playerCount: options.playerCount,
    executeOp: (snap, pend, op) => executeOp(def, options, snap, pend, op),
    push: () => {},
    record: ({ players, spectator }, meta) => records.push({ views: players, spectator, meta }),
  });
  return { host, records };
}

/** Steps 1-3: finish a game on one host, restore a second from what it left. */
async function restoredFromFinished(winnerSeats: number[]) {
  const def = finishedGameDef(winnerSeats);
  const first = makeHost(def);
  await first.host.start();
  expect(first.host.isComplete).toBe(true);

  const stored = JSON.parse(JSON.stringify(first.host.durableState())) as SnapshotHostState;
  const last = first.records.at(-1)!;
  const second = makeHost(def);
  second.host.restoreFrom({ ...stored, playerViews: last.views, spectatorView: last.spectator });
  return second;
}

describe('a host restored from a finished game publishes its outcome (#490)', () => {
  it('broadcastCurrent() after the restore records the game as complete, with its winners', async () => {
    const { host, records } = await restoredFromFinished([2]);
    host.broadcastCurrent();
    expect(records.at(-1)!.meta).toMatchObject({ isComplete: true, winners: [2], isDraw: false });
    expect(host.isComplete).toBe(true);
    expect(host.winners).toEqual([2]);
  });

  it('rosterChanged() after the restore records the game as complete, with its winners', async () => {
    const { host, records } = await restoredFromFinished([1, 3]);
    host.rosterChanged();
    expect(records.at(-1)!.meta).toMatchObject({ isComplete: true, winners: [1, 3], isDraw: false });
  });

  it('a finished game with no winners is restored as a draw, not as a running game', async () => {
    const { host, records } = await restoredFromFinished([]);
    host.broadcastCurrent();
    expect(records.at(-1)!.meta).toMatchObject({ isComplete: true, winners: [], isDraw: true });
    expect(records.at(-1)!.meta.turnBoundary.dueSeats).toEqual([]);
  });

  it('durableState() carries the outcome, so a platform cannot store a finished game without it', async () => {
    const { host } = makeHost(finishedGameDef([2]));
    await host.start();
    expect(host.durableState()).toMatchObject({ isComplete: true, winners: [2] });
  });

  it('restoreFrom refuses a state without the outcome, naming what to store', async () => {
    const { host } = makeHost(finishedGameDef([2]));
    await host.start();
    const { snapshot, flowState, pendingStates } = host.durableState();
    const fresh = makeHost(finishedGameDef([2])).host;
    // @ts-expect-error -- the outcome is required.
    expect(() => fresh.restoreFrom({ snapshot, flowState, pendingStates })).toThrow(/isComplete/);
    // @ts-expect-error -- the outcome is required.
    expect(() => fresh.restoreFrom({ snapshot, flowState, pendingStates, isComplete: true })).toThrow(/winners/);
  });

  it('restoreFrom refuses winners that are not seats of this table, or a winner of a running game', async () => {
    const { host } = makeHost(finishedGameDef([2]));
    await host.start();
    const stored = host.durableState();
    const fresh = makeHost(finishedGameDef([2])).host;
    for (const winners of [[0], [4], [1.5], ['2']] as unknown as number[][]) {
      expect(() => fresh.restoreFrom({ ...stored, winners })).toThrow(/seats 1 to 3/);
    }
    expect(() => fresh.restoreFrom({ ...stored, isComplete: false, winners: [2] })).toThrow(/not finished/);
  });
});
