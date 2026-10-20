import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, loop, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike, type Op } from './stateless-ops.js';
import { stubExecuteOp } from './op-result.test-helper.js';
import { SnapshotSessionHost, type SeatOp } from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';

// #738: the host keeps a seat's half-made picks under the seat it was called
// for, so an op that names a different `player` would act as one seat with
// another seat's picks. Every op that names a player must name the caller.

class PassGame extends Game<PassGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({
        maxIterations: 1000,
        do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(2)!, turnScope: 'restart' }),
      }),
    });
  }
}

const passDef: GameDefinitionLike = { gameClass: PassGame, gameType: 'pass', minPlayers: 2, maxPlayers: 2 };

async function startedHost() {
  const executed: Op['type'][] = [];
  const host = new SnapshotSessionHost({
    playerCount: 2,
    executeOp: (snap, pend, op) => {
      executed.push(op.type);
      return executeOp(passDef, { playerCount: 2, seed: 'bs738' }, snap, pend, op);
    },
    record: () => {}, push: () => {},
  });
  await host.start();
  executed.length = 0;
  return { host, executed };
}


// A seat's pending state after the first pick of a two-pick action.
const HALF_MADE = { actionName: 'two', playerPosition: 2, collectedArgs: { first: 'a' }, currentSelectionIndex: 1 };

describe('#738: an op naming another seat is refused', () => {
  const opsAsSeat2 = (host: SnapshotSessionHost): SeatOp[] => [
    { type: 'action', actionName: 'pass', player: 2, args: {}, boundaryKey: boundaryKeyOfHost(host) },
    { type: 'expireSeat', player: 2, idleAction: 'pass', args: {}, boundaryKey: boundaryKeyOfHost(host) },
    { type: 'selectionStep', player: 2, selectionName: 'x', value: 1, actionName: 'pass', boundaryKey: boundaryKeyOfHost(host) },
    { type: 'resolveChoices', actionName: 'pass', player: 2, selectionName: 'x', args: {} },
    { type: 'cancelAction', player: 2 },
    { type: 'undo', player: 2 },
    { type: 'startTutorial', player: 2 },
    { type: 'exitTutorial', player: 2 },
  ];

  it('refuses every player-naming op from seat 1 that names seat 2, without running it', async () => {
    const { host, executed } = await startedHost();
    for (const op of opsAsSeat2(host)) {
      const res = await host.handleOp(1, op);
      expect(res.success, op.type).toBe(false);
      expect(!res.success && res.error, op.type).toMatch(/seat 1 sent '\w+' as seat 2/i);
    }
    expect(executed).toEqual([]);
  });

  it('still runs an op whose player is the calling seat', async () => {
    const { host } = await startedHost();
    const res = await host.handleOp(2, {
      type: 'action', actionName: 'pass', player: 2, args: {}, boundaryKey: boundaryKeyOfHost(host),
    });
    expect(res.success, !res.success ? res.error : '').toBe(true);
  });
});

// #950: hint, heatmapToggle and convertSeatToBot name their seat as `seat`, not `player`.
describe('#950: an op naming another seat as `seat` is refused', () => {
  const opsAsSeat1: SeatOp[] = [
    { type: 'hint', seat: 1 },
    { type: 'heatmapToggle', seat: 1, visible: true },
    { type: 'convertSeatToBot', seat: 1 },
  ];

  it('refuses every seat-naming op from seat 2 that names seat 1, without running it', async () => {
    const { host, executed } = await startedHost();
    host.setBotSeats([{ seat: 1 }]);
    for (const op of opsAsSeat1) {
      const res = await host.handleOp(2, op);
      expect(res.success, op.type).toBe(false);
      expect(!res.success && res.error, op.type).toMatch(/seat 2 sent '\w+' as seat 1/i);
    }
    expect(executed).toEqual([]);
  });
});

// #1100, #1102: only the host itself sends these: it calls executeOp directly, never handleOp.
describe('#1100, #1102: a host-only op sent through handleOp is refused', () => {
  it('refuses start, restoreEarlier and botSuggest from a seat, without running them or changing the game', async () => {
    const { host, executed } = await startedHost();
    host.setBotSeats([{ seat: 2 }]);
    const earlier = host.snapshot;
    await host.handleOp(2, { type: 'action', actionName: 'pass', player: 2, args: {}, boundaryKey: boundaryKeyOfHost(host) });
    await host.settled();
    executed.length = 0;
    const now = host.snapshot;
    // #1109: handleOp's type refuses each of these too; the run-time refusal is for untrusted wire input.
    const results = [
      // @ts-expect-error start is host-only
      ['start', await host.handleOp(1, { type: 'start' })],
      // @ts-expect-error restoreEarlier is host-only
      ['restoreEarlier', await host.handleOp(1, { type: 'restoreEarlier', snapshot: earlier })],
      // @ts-expect-error botSuggest is host-only
      ['botSuggest', await host.handleOp(1, { type: 'botSuggest', seats: [{ seat: 2 }] })],
    ] as const;
    for (const [type, res] of results) {
      expect(res.success, type).toBe(false);
      expect(!res.success && res.error, type).toBe(
        `Seat 1 sent '${type}', and was refused: only the host itself sends it, ` +
          'through host.start(), host.restoreEarlier(snapshot) or host.runBotTurns(), never through handleOp.',
      );
      expect(!res.success && res.category, type).toBe('protocol');
    }
    expect(executed).toEqual([]);
    expect(host.snapshot).toBe(now);
  });

  it('restores an earlier position through the host-only entry point', async () => {
    const { host } = await startedHost();
    const earlier = host.snapshot!;
    await host.handleOp(2, { type: 'action', actionName: 'pass', player: 2, args: {}, boundaryKey: boundaryKeyOfHost(host) });
    const res = await host.restoreEarlier(earlier);
    expect(res.success, !res.success ? res.error : '').toBe(true);
    expect(host.snapshot!.actionHistory).toEqual(earlier.actionHistory);
  });

  it("drops every seat's half-made picks and hints, as a rewind does", async () => {
    let lastEnvelope: object = {};
    // PassGame has no two-pick action or hint, so seat 2's pick and hint are stubbed.
    const host = new SnapshotSessionHost({
      playerCount: 2,
      executeOp: stubExecuteOp(async (snap, pend, op) => {
        if (op.type === 'hint') return { success: true, hintAnnotation: { seat: op.seat, annotation: { text: 'pass' } } };
        if (op.type === 'selectionStep') return { ...lastEnvelope, actionComplete: false, pendingState: HALF_MADE };
        const res = await executeOp(passDef, { playerCount: 2, seed: 'bs1102' }, snap, pend, op);
        if (res.success && 'snapshot' in res) lastEnvelope = res;
        return res;
      }),
      record: () => {}, push: () => {},
    });
    await host.start();
    const earlier = host.snapshot!;
    expect((await host.handleOp(2, { type: 'hint', seat: 2 })).success).toBe(true);
    expect((await host.handleOp(2, {
      type: 'selectionStep', player: 2, selectionName: 'first', value: 'a', actionName: 'pass', boundaryKey: boundaryKeyOfHost(host),
    })).success).toBe(true);
    expect(host.durableState().pendingStates['2']).toEqual(HALF_MADE);
    expect(host.transientTeachingState.get(2)?.hint).toBeDefined();

    expect((await host.restoreEarlier(earlier)).success).toBe(true);

    expect(host.durableState().pendingStates['2']).toBeUndefined();
    expect(host.transientTeachingState.has(2)).toBe(false);
  });
});
