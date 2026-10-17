import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, loop, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike, type Op } from './stateless-ops.js';
import { SnapshotSessionHost } from './snapshot-session-host.js';
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

describe('#738: an op naming another seat is refused', () => {
  const opsAsSeat2 = (host: SnapshotSessionHost): Op[] => [
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
  const opsAsSeat1: Op[] = [
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
