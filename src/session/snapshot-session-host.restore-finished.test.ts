/**
 * A host rebuilt from a finished game's persisted state publishes the game's
 * real outcome (#490).
 *
 * The steps are the issue's: play a game to its end, take `durableState()` and
 * the views last handed to `record`, and restore a second host from them with
 * `SnapshotSessionHost.restore()`, which publishes. The persisted state crosses
 * a JSON round trip, the way a Durable Object's storage hands it back.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';
import { Game, Player, Action, defineFlow, execute, loop, actionStep, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import {
  SnapshotSessionHost,
  flowStateOf,
  isCompleteOf,
  winnersOf,
  type PublishMeta,
  type SnapshotHostState,
  type SnapshotSessionAdapters,
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
 * With `flowEnds`, the loop's own `while` stops on `isFinished()`. Without it the
 * loop would go on, which before #492 left the op reporting winners for a game
 * that was not complete; the flow now ends either way.
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

/**
 * A game that names a leader while play goes on: `getWinners()` is overridden to
 * report the seat with the most points, and the flow never ends. An op reports
 * that seat in `winners` with `isComplete` false, a state the engine really
 * produces, so `restore` must take it back.
 */
function leaderDef(): GameDefinitionLike {
  class LeaderGame extends Game<LeaderGame, Player> {
    points: Record<number, number> = {};

    constructor(gameOptions: GameOptions) {
      super(gameOptions);
      this.registerAction(
        Action.create('win').execute((_args, ctx) => {
          const seat = (ctx.player as Player).seat;
          this.points[seat] = (this.points[seat] ?? 0) + 1;
        }),
      );
      this.setFlow(defineFlow({ root: loop({ maxIterations: 10, do: actionStep({ actions: ['win'] }) }) }));
    }

    override getWinners(): Player[] {
      const scored = Object.entries(this.points).sort(([, a], [, b]) => b - a);
      return scored.length > 0 ? [this.getPlayer(Number(scored[0]![0]))!] : [];
    }
  }
  return { gameClass: LeaderGame, gameType: 'leader', minPlayers: 1, maxPlayers: 4 };
}

const options = { playerCount: 3, seed: 'bs490' };

function makeAdapters(def: GameDefinitionLike) {
  const records: Array<{ views: unknown[]; spectator: unknown; meta: PublishMeta }> = [];
  const adapters: SnapshotSessionAdapters = {
    playerCount: options.playerCount,
    executeOp: (snap, pend, op) => executeOp(def, options, snap, pend, op),
    push: () => {},
    record: ({ players, spectator }, meta) => records.push({ views: players, spectator, meta }),
  };
  return { adapters, records };
}

function makeHost(def: GameDefinitionLike) {
  const { adapters, records } = makeAdapters(def);
  return { host: new SnapshotSessionHost(adapters), records };
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
  const { adapters, records } = makeAdapters(def);
  const host = SnapshotSessionHost.restore(adapters, { ...stored, playerViews: last.views, spectatorView: last.spectator });
  return { host, records };
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
  it('the restore records the game as complete, with its winners', async () => {
    const { host, records } = await restoredFromFinished([2]);
    expect(records.at(-1)!.meta).toMatchObject({ cause: 'restore', isComplete: true, winners: [2], isDraw: false });
    expect(host.isComplete).toBe(true);
    expect(host.winners).toEqual([2]);
  });

  it('a republish after the restore records the game as complete, with its winners', async () => {
    const { host, records } = await restoredFromFinished([1, 3]);
    host.broadcastCurrent();
    expect(records.at(-1)!.meta).toMatchObject({ cause: 'republish', isComplete: true, winners: [1, 3], isDraw: false });
  });

  it('a finished game with no winners is restored as a draw, not as a running game', async () => {
    const { records } = await restoredFromFinished([]);
    expect(records.at(-1)!.meta).toMatchObject({ isComplete: true, winners: [], isDraw: true });
    expect(records.at(-1)!.meta.turnBoundary.dueSeats).toEqual([]);
  });

  it('durableState() is the snapshot and the pending selections, and nothing else (#536)', async () => {
    expectTypeOf<keyof SnapshotHostState>().toEqualTypeOf<'snapshot' | 'pendingStates'>();
    const { host } = makeHost(finishedGameDef([2]));
    await host.start();
    const state = host.durableState();
    expect(Object.keys(state).sort()).toEqual(['pendingStates', 'snapshot']);
    expect(isCompleteOf(state)).toBe(true);
    expect(winnersOf(state)).toEqual([2]);
    expect(flowStateOf(state)).toMatchObject({ complete: true });
  });

  it('a finished game restored from { snapshot, pendingStates } alone publishes as complete with its winners', async () => {
    const def = finishedGameDef([3]);
    const first = makeHost(def);
    await first.host.start();
    const { snapshot, pendingStates } = JSON.parse(JSON.stringify(first.host.durableState())) as SnapshotHostState;
    const { adapters, records } = makeAdapters(def);
    SnapshotSessionHost.restore(adapters, { snapshot, pendingStates });
    expect(records.at(-1)!.meta).toMatchObject({ isComplete: true, winners: [3], isDraw: false });
    expect(records.at(-1)!.meta.turnBoundary.dueSeats).toEqual([]);
  });

  it('restore refuses a snapshot without its flow state or its winners, naming what is missing', async () => {
    const { host } = makeHost(finishedGameDef([2]));
    await host.start();
    const stored = JSON.parse(JSON.stringify(host.durableState())) as SnapshotHostState;
    const { adapters, records } = makeAdapters(finishedGameDef([2]));
    const { flowState: _f, ...noFlow } = stored.snapshot!;
    expect(() => SnapshotSessionHost.restore(adapters, { ...stored, snapshot: noFlow as typeof stored.snapshot })).toThrow(/flow state/);
    const { winners: _w, ...noWinners } = stored.snapshot!;
    expect(() => SnapshotSessionHost.restore(adapters, { ...stored, snapshot: noWinners as typeof stored.snapshot })).toThrow(/winners/);
    expect(() => SnapshotSessionHost.restore(adapters, { ...stored, snapshot: null })).toThrow(/snapshot/);
    expect(records).toEqual([]);
  });

  it('restore refuses winners that are not seats of this table', async () => {
    const { host } = makeHost(finishedGameDef([2]));
    await host.start();
    const stored = host.durableState();
    const { adapters } = makeAdapters(finishedGameDef([2]));
    for (const winners of [[0], [4], [1.5], ['2']] as unknown as number[][]) {
      expect(() => SnapshotSessionHost.restore(adapters, { ...stored, snapshot: { ...stored.snapshot!, winners } })).toThrow(/seats 1 to 3/);
    }
  });

  it('a game a seat finishes with an action op is restored as complete, with that seat the winner', async () => {
    const { seat, records } = await restoredFromActionFinish(true);
    expect(records.at(-1)!.meta).toMatchObject({ isComplete: true, winners: [seat], isDraw: false });
    expect(records.at(-1)!.meta.turnBoundary.dueSeats).toEqual([]);
  });

  it('winners for a game that is not complete round-trip as they were, so the table can wake', async () => {
    const def = leaderDef();
    const first = makeHost(def);
    await first.host.start();
    const seat = await playWin(first.host, first.records);
    expect(first.records.at(-1)!.meta).toMatchObject({ isComplete: false, winners: [seat] });
    expect(isCompleteOf(first.host.durableState())).toBe(false);
    expect(winnersOf(first.host.durableState())).toEqual([seat]);

    const { host, records } = restoreSecond(def, first);
    expect(records.at(-1)!.meta).toMatchObject({ isComplete: false, winners: [seat], isDraw: false });
    expect(records.at(-1)!.meta.turnBoundary.dueSeats).not.toEqual([]);
    expect(winnersOf(host.durableState())).toEqual([seat]);
  });

  it('a game finished inside a loop that does not stop on isFinished() is restored as complete too (#492)', async () => {
    // game.finish([player]) ends the flow whatever loop it is in, so there is
    // no "winners but not complete" state left for restore to carry.
    const { seat, host, records } = await restoredFromActionFinish(false);
    expect(records.at(-1)!.meta).toMatchObject({ isComplete: true, winners: [seat], isDraw: false });
    expect(isCompleteOf(host.durableState())).toBe(true);
    expect(winnersOf(host.durableState())).toEqual([seat]);
  });
});
