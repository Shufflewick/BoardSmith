import { describe, it, expect } from 'vitest';
import { executeOp, type OpResult, type StateEnvelope } from './stateless-ops.js';
import { flowBoundaryKey, type BoundaryKeyState } from '../engine/index.js';
import type { GameStateSnapshot } from '../engine/utils/index.js';
import type { PlayerGameState } from './types.js';
import { seatUndoDefinition } from './testing/fixtures/seat-undo-fixture.js';
import { succeeded, refused } from './op-result.test-helper.js';
import { createHeadlessSession } from '../testing/headless-session.js';

// #1526: in a simultaneous step declared `seatUndo: true`, each seat's undo
// takes back its own last action, one at a time, whatever the other seat did,
// and nothing another seat is sent changes when a seat acts in secret or
// undoes. Driven through the stateless executor, op after op, as every host
// drives it.

// Every run starts from one saved position, so two runs differ only in what
// the seats did (see secret-action-counts.test.ts for why).
const options = { playerCount: 2, seed: 'bs1526', elementIdKey: '0000000000001526' };
const startOptions = { playerCount: options.playerCount, seed: options.seed };
let dealtPosition: GameStateSnapshot | undefined;

async function table() {
  if (dealtPosition === undefined) {
    dealtPosition = succeeded(await executeOp(seatUndoDefinition, startOptions, null, null, { type: 'start' })).snapshot as GameStateSnapshot;
  }
  let last: StateEnvelope = succeeded(await executeOp(seatUndoDefinition, startOptions, null, null, { type: 'start' }, {
    seedSnapshot: dealtPosition,
  }));
  const boundaryKey = () => flowBoundaryKey(last.snapshot.flowState as BoundaryKeyState);
  const keep = (res: OpResult): OpResult => {
    if (res.success && 'snapshot' in res) last = res as StateEnvelope & OpResult;
    return res;
  };
  return {
    get last(): StateEnvelope {
      return last;
    },
    seat(seat: number): PlayerGameState {
      return (last.playerViews[seat - 1] as { state: PlayerGameState }).state;
    },
    packs(seat: number): number {
      return (last.snapshot.actionCheckpoints!.entries.at(-1)!.state.children!
        .find((c) => c.attributes.seat === seat)!.attributes.packs) as number;
    },
    async act(seat: number, actionName: string): Promise<void> {
      succeeded(keep(await executeOp(seatUndoDefinition, options, last.snapshot, null, {
        type: 'action', actionName, player: seat, args: {}, boundaryKey: boundaryKey(),
      })));
    },
    async undo(seat: number): Promise<OpResult> {
      return keep(await executeOp(seatUndoDefinition, options, last.snapshot, null, { type: 'undo', player: seat }));
    },
  };
}

/** `gameInstanceId` names the game, and two separate games are compared here. */
function sameGameId(value: unknown): string {
  return JSON.stringify(value).replace(/"gameInstanceId":"[^"]*"/g, '"gameInstanceId":"<game>"');
}

describe('per-seat undo in a simultaneous step (#1526)', () => {
  it('each seat undoes its own actions one at a time, whatever the other seat did since', async () => {
    const game = await table();
    await game.act(1, 'placePack');
    await game.act(2, 'placePack');
    await game.act(1, 'placePack');

    // Seat 2 acted before seat 1's last action, and may still undo its own.
    expect(game.seat(2).canUndo).toBe(true);
    succeeded(await game.undo(2));
    expect(game.packs(2)).toBe(0);
    expect(game.packs(1)).toBe(2);

    // Seat 1 takes back one action, then the one before it.
    expect(game.seat(1).actionsThisTurn).toBe(2);
    succeeded(await game.undo(1));
    expect(game.packs(1)).toBe(1);
    expect(game.seat(1).actionsThisTurn).toBe(1);
    succeeded(await game.undo(1));
    expect(game.packs(1)).toBe(0);
    expect(game.seat(1).canUndo).toBe(false);
    expect(refused(await game.undo(1)).error).toBe('No actions to undo');
  });

  it("another seat's secret actions and undos change nothing a seat or a spectator is sent", async () => {
    // Seat 2 takes the same two actions in both runs, the last op of each, so
    // only what seat 1 did in between differs.
    const quiet = await table();
    await quiet.act(2, 'placePack');
    await quiet.act(2, 'placePack');

    const busy = await table();
    await busy.act(2, 'placePack');
    await busy.act(1, 'placePack');
    await busy.act(1, 'placePack');
    succeeded(await busy.undo(1));
    await busy.act(2, 'placePack');

    expect(sameGameId(busy.last.playerViews[1])).toBe(sameGameId(quiet.last.playerViews[1]));
    expect(sameGameId(busy.last.spectatorView)).toBe(sameGameId(quiet.last.spectatorView));
    expect(busy.seat(2).canUndo).toBe(true);
    expect(busy.seat(2).actionsThisTurn).toBe(2);
  });

  it('only the undoing seat is told its tree was restored', async () => {
    const game = await table();
    await game.act(1, 'placePack');
    const before = [game.seat(1).restoreEpoch, game.seat(2).restoreEpoch];
    succeeded(await game.undo(1));
    expect(game.seat(1).restoreEpoch).toBeGreaterThan(before[0]);
    expect(game.seat(2).restoreEpoch).toBe(before[1]);
  });

  it("an undo takes back the action's own log line and the element it created in the seat's Player", async () => {
    const game = await table();
    await game.act(1, 'placePack');
    expect(game.seat(1).messages?.map((m) => m.text)).toContain('You placed a pack');
    await game.act(1, 'stashToken');
    expect(JSON.stringify(game.seat(1).view)).toContain('SeatUndoToken');
    succeeded(await game.undo(1));
    expect(JSON.stringify(game.seat(1).view)).not.toContain('SeatUndoToken');
    succeeded(await game.undo(1));
    expect(game.seat(1).messages?.map((m) => m.text) ?? []).not.toContain('You placed a pack');
  });

  it('an undo after the action that ended the seat\'s part puts the seat back in the step', async () => {
    const game = await table();
    await game.act(1, 'placePack');
    await game.act(1, 'done');
    expect(game.seat(1).isMyTurn).toBe(false);
    succeeded(await game.undo(1));
    expect(game.seat(1).isMyTurn).toBe(true);
    expect(game.seat(1).availableActions).toContain('placePack');
    await game.act(1, 'placePack');
    expect(game.packs(1)).toBe(2);
  });

  it.each([
    ['draftPack', 'draftPack changed the game outside your own player'],
    ['rollPack', 'rollPack drew a random number'],
    ['announcePack', 'announcePack wrote a line other seats can read'],
    ['raidPack', 'raidPack changed the game outside your own player'],
    ['burnPack', 'burnPack is marked notUndoable'],
  ])('%s cannot be taken back on its own, and the seat says why', async (fence, reason) => {
    const game = await table();
    await game.act(1, 'placePack');
    await game.act(1, fence);
    await game.act(1, 'placePack');
    await game.act(2, 'placePack');
    succeeded(await game.undo(1));
    expect(game.seat(1).canUndo).toBe(false);
    expect(refused(await game.undo(1)).error).toContain(reason);
    // The other seat's undo is its own.
    expect(game.seat(2).canUndo).toBe(true);
    succeeded(await game.undo(2));
  });

  it("an action that changed another seat's player ends that seat's undo too", async () => {
    const game = await table();
    await game.act(2, 'placePack');
    await game.act(1, 'raidPack');
    expect(game.seat(2).canUndo).toBe(false);
    expect(refused(await game.undo(2)).error).toContain("another seat's action changed your own player");
  });

  it('a pick that changed the game outside the seat makes its action a fence', async () => {
    const game = await table();
    await game.act(1, 'placePack');
    const picked = succeeded(await executeOp(seatUndoDefinition, options, game.last.snapshot, null, {
      type: 'selectionStep', player: 1, selectionName: 'size', value: 'small', actionName: 'pickPack',
      boundaryKey: flowBoundaryKey(game.last.snapshot.flowState as BoundaryKeyState),
    }));
    expect(picked.success).toBe(true);
    const done = picked as StateEnvelope;
    const seat1 = (done.playerViews[0] as { state: PlayerGameState }).state;
    expect(seat1.canUndo).toBe(false);
  });
});

describe('a seat undoing its own part at a hosted table (#1526)', () => {
  it("is pushed to that seat alone, and leaves another seat's half-made pick as it was", async () => {
    const table = createHeadlessSession(seatUndoDefinition, { playerCount: 2, seed: 'bs1526' });
    await table.host.start();
    const key = () => table.metas.at(-1)!.turnBoundary.key;
    succeeded(await table.host.handleOp(1, { type: 'action', actionName: 'placePack', player: 1, args: {}, boundaryKey: key() }));
    succeeded(await table.host.handleOp(2, {
      type: 'selectionStep', player: 2, selectionName: 'first', value: 'small', actionName: 'pairPack', boundaryKey: key(),
    }));
    const from = table.pushes.length;

    succeeded(await table.host.handleOp(1, { type: 'undo', player: 1 }));
    expect(table.pushes.slice(from).map((push) => push.map((p) => p.seat))).toEqual([[1]]);
    const seat2 = (table.broadcasts.at(-1) as Array<{ state: PlayerGameState }>)[1]!.state;
    expect(seat2.pendingAction?.actionName).toBe('pairPack');

    succeeded(await table.host.handleOp(2, {
      type: 'selectionStep', player: 2, selectionName: 'second', value: 'large', actionName: 'pairPack', boundaryKey: key(),
    }));
    const seat2After = (table.broadcasts.at(-1) as Array<{ state: PlayerGameState }>)[1]!.state;
    expect(seat2After.canUndo).toBe(true);
  });
});
