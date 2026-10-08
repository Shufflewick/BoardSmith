import { describe, it, expect } from 'vitest';
import { executeOp, type OpResult, type StateEnvelope } from './stateless-ops.js';
import { flowBoundaryKey, type BoundaryKeyState, type GameStateSnapshot } from '../engine/index.js';
import { secretDeploymentDefinition } from './testing/fixtures/secret-deployment-fixture.js';
import { succeeded } from './op-result.test-helper.js';

// #449: what a seat or a spectator receives must not let it count another
// seat's SECRET actions. In the fixture's deployment step a seat's `placePack`
// changes nothing anyone else may see, so everything seat 2 and a spectator
// are sent has to be the same whether seat 1 placed no packs or several. The
// counters that broke this were `state.actionCount` (the length of the whole
// action history), the flow's `moveCount` (top level and inside the position's
// frame data), and the undo refusal, which named the refused action by its
// index in the whole history.

// One seed for both runs, so seat 1's secret placements are the only
// difference between them. The runs also need one element id key (#447), and
// a start op refuses a key from outside, so every run starts from the same
// saved position (`hostOptions.seedSnapshot`), the way a host resumes a game
// it holds. (The stateful GameSession this file also drove was removed, #529;
// every host runs this executor.)
const options = { playerCount: 2, seed: 'bs449', elementIdKey: '0000000000000449' };
const statelessOptions = { playerCount: options.playerCount, seed: options.seed };
let dealtPosition: GameStateSnapshot | undefined;

/** The stateless executor, op after op, as a platform host drives it. */
async function statelessGame() {
  if (dealtPosition === undefined) {
    const dealt = succeeded(await executeOp(secretDeploymentDefinition, statelessOptions, null, null, { type: 'start' }));
    expect(dealt.success).toBe(true);
    dealtPosition = dealt.snapshot as GameStateSnapshot;
  }
  let last: StateEnvelope = succeeded(await executeOp(secretDeploymentDefinition, statelessOptions, null, null, { type: 'start' }, {
    seedSnapshot: dealtPosition,
  }));
  return {
    get last(): StateEnvelope {
      return last;
    },
    async act(seat: number, actionName: string): Promise<OpResult> {
      const res = await executeOp(secretDeploymentDefinition, options, last.snapshot, null, {
        type: 'action',
        actionName,
        player: seat,
        args: {},
        boundaryKey: flowBoundaryKey(last.snapshot.flowState as BoundaryKeyState),
      });
      if (res.success) last = res;
      return res;
    },
    async undo(seat: number): Promise<OpResult> {
      const res = await executeOp(secretDeploymentDefinition, options, last.snapshot, null, { type: 'undo', player: seat });
      if (res.success) last = res;
      return res;
    },
  };
}

/** A table either executor runs: an action by name for a seat, and a seat's undo. */
interface Table {
  act(seat: number, actionName: string): Promise<{ success: boolean }>;
  undo(seat: number): Promise<{ success: boolean; error?: string }>;
}

async function seat1PlacesPacks(table: Table, packs: number): Promise<void> {
  for (let i = 0; i < packs; i++) expect((await table.act(1, 'placePack')).success).toBe(true);
}

/** Seat 2 burns a pack and asks to undo; its refusal must read the same however many packs seat 1 placed. */
async function expectSeat2RefusalBlindToSeat1(newTable: () => Promise<Table>): Promise<void> {
  const refusalAfter = async (packs: number) => {
    const table = await newTable();
    await seat1PlacesPacks(table, packs);
    expect((await table.act(2, 'burnPack')).success).toBe(true);
    const undo = await table.undo(2);
    expect(undo.success).toBe(false);
    return undo.error;
  };
  const none = await refusalAfter(0);
  expect(none).toContain('burnPack');
  expect(await refusalAfter(2)).toBe(none);
}

/** What seat 2 and the spectator were sent by the last op, with seat 1 placing `packs` packs first. */
async function statelessSeenBySeat2AndSpectator(packs: number) {
  const game = await statelessGame();
  await seat1PlacesPacks(game, packs);
  // Seat 2 acts publicly last, so every observation is taken from the same kind of op.
  expect((await game.act(2, 'done')).success).toBe(true);
  expect(game.last.playerViews[1]).toBeDefined();
  expect(game.last.spectatorView).toBeDefined();
  return {
    seat2: game.last.playerViews[1],
    spectator: game.last.spectatorView,
    meta: { isComplete: game.last.snapshot.flowState?.complete, winners: game.last.snapshot.winners },
  };
}

/** `gameInstanceId` names the game, and two separate games are compared here. */
function sameGameId(value: unknown): string {
  return JSON.stringify(value).replace(/"gameInstanceId":"[^"]*"/g, '"gameInstanceId":"<game>"');
}

describe("a seat cannot count another seat's secret actions (#449)", () => {
  describe('stateless executor (platform and dev host)', () => {
    it("seat 2's view and the spectator view are the same whether seat 1 placed 0 or 2 secret packs", async () => {
      const none = await statelessSeenBySeat2AndSpectator(0);
      const two = await statelessSeenBySeat2AndSpectator(2);
      expect(sameGameId(two.seat2)).toBe(sameGameId(none.seat2));
      expect(sameGameId(two.spectator)).toBe(sameGameId(none.spectator));
      expect(two.meta).toEqual(none.meta);
    });

    it("the undo refusal seat 2 reads does not depend on seat 1's secret actions", async () => {
      await expectSeat2RefusalBlindToSeat1(statelessGame);
    });

    it('undo still takes back exactly the seat\'s own secret actions', async () => {
      const game = await statelessGame();
      expect((await game.act(1, 'placePack')).success).toBe(true);
      expect((await game.act(2, 'placePack')).success).toBe(true);
      expect((await game.act(2, 'placePack')).success).toBe(true);
      const seat2 = (game.last.playerViews[1] as { state: { canUndo?: boolean } }).state;
      expect(seat2.canUndo).toBe(true);
      expect((await game.undo(2)).success).toBe(true);
      const view = game.last.playerViews[1] as { state: { view: unknown } };
      expect(JSON.stringify(view.state.view)).toContain('"packs":0');
      const seat1 = game.last.playerViews[0] as { state: { view: unknown } };
      expect(JSON.stringify(seat1.state.view)).toContain('"packs":1');
    });
  });
});
