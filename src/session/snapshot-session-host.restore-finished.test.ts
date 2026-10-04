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
import { Game, Player, Action, defineFlow, execute, loop, actionStep, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import {
  SnapshotSessionHost,
  type PublishMeta,
  type SnapshotHostState,
} from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';

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

/**
 * A game the acting seat ends with an action: `win` calls `game.finish([player])`.
 * With `flowEnds`, the loop stops on `isFinished()` and the flow completes. Without
 * it the loop goes on, and the op reports winners for a game that is not complete:
 * a state the engine really produces, so `restoreFrom` must take it back.
 */
function actionFinishDef(flowEnds: boolean): GameDefinitionLike {
  class ActionFinishGame extends Game<ActionFinishGame, Player> {
    constructor(options: GameOptions) {
      super(options);
      this.registerAction(
        Action.create('win').execute((_args, ctx) => {
          this.finish([ctx.player as Player]);
        }),
      );
      this.setFlow(
        defineFlow({
          root: loop({
            maxIterations: 10,
            while: (ctx) => !flowEnds || !ctx.game.isFinished(),
            do: actionStep({ actions: ['win'] }),
          }),
        }),
      );
    }
  }
  return { gameClass: ActionFinishGame, gameType: 'action-finish', minPlayers: 1, maxPlayers: 4 };
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

/** The first seat the host says owes a move plays `win`. */
async function playWin(host: SnapshotSessionHost, records: Array<{ meta: PublishMeta }>) {
  const seat = records.at(-1)!.meta.turnBoundary.dueSeats[0]!;
  const res = await host.handleOp(seat, {
    type: 'action',
    actionName: 'win',
    player: seat,
    args: {},
    boundaryKey: boundaryKeyOfHost(host),
  });
  expect(res.success).toBe(true);
  return seat;
}

/** Step 3: restore a second host from what `first` left, through a JSON round trip. */
function restoreSecond(def: GameDefinitionLike, first: ReturnType<typeof makeHost>) {
  const stored = JSON.parse(JSON.stringify(first.host.durableState())) as SnapshotHostState;
  const last = first.records.at(-1)!;
  const second = makeHost(def);
  second.host.restoreFrom({ ...stored, playerViews: last.views, spectatorView: last.spectator });
  return second;
}

/** Steps 1-3: finish a game on one host, restore a second from what it left. */
async function restoredFromFinished(winnerSeats: number[]) {
  const def = finishedGameDef(winnerSeats);
  const first = makeHost(def);
  await first.host.start();
  expect(first.host.isComplete).toBe(true);
  return restoreSecond(def, first);
}

/** Steps 1-3 for a game a seat ended with an action op. */
async function restoredFromActionFinish(flowEnds: boolean) {
  const def = actionFinishDef(flowEnds);
  const first = makeHost(def);
  await first.host.start();
  expect(first.host.isComplete).toBe(false);
  const seat = await playWin(first.host, first.records);
  expect(first.host.winners).toEqual([seat]);
  return { seat, ...restoreSecond(def, first) };
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

  it('restoreFrom refuses winners that are not seats of this table', async () => {
    const { host } = makeHost(finishedGameDef([2]));
    await host.start();
    const stored = host.durableState();
    const fresh = makeHost(finishedGameDef([2])).host;
    for (const winners of [[0], [4], [1.5], ['2']] as unknown as number[][]) {
      expect(() => fresh.restoreFrom({ ...stored, winners })).toThrow(/seats 1 to 3/);
    }
  });

  it('a game a seat finishes with an action op is restored as complete, with that seat the winner', async () => {
    const { seat, host, records } = await restoredFromActionFinish(true);
    host.rosterChanged();
    expect(records.at(-1)!.meta).toMatchObject({ isComplete: true, winners: [seat], isDraw: false });
    expect(records.at(-1)!.meta.turnBoundary.dueSeats).toEqual([]);
  });

  it('winners for a game whose flow has not ended round-trip as they were, so the table can wake', async () => {
    // game.finish([player]) inside a loop that does not stop on isFinished():
    // the op reports winners while isComplete stays false. restoreFrom takes
    // back anything durableState() can return.
    const { seat, host, records } = await restoredFromActionFinish(false);
    host.broadcastCurrent();
    expect(records.at(-1)!.meta).toMatchObject({ isComplete: false, winners: [seat], isDraw: false });
    expect(host.durableState()).toMatchObject({ isComplete: false, winners: [seat] });
  });
});
