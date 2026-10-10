/**
 * The Debug panel's two host-fed features on the live path (#547):
 * `SnapshotSessionHost` over `executeOp`, the host `boardsmith dev` and the
 * platform both run.
 *
 * 1. `Game.registerDebug()` data reaches only the seat that asks for it with
 *    the `debugCustomData` op, only while the host has debugging on. It is
 *    never part of a published view.
 * 2. The host records when each move arrived, outside game state, and stamps
 *    those times on its `debugHistory` answer. The engine's snapshot carries
 *    no wall-clock value.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Game, Player, Action, actionStep, loop, type GameOptions } from '../engine/index.js';
import { createHeadlessSession } from './headless-session.js';
import { SnapshotSessionHost } from './snapshot-session-host.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';

const SECRET_VALUE = 'top-secret-deck-order';

class DebugGame extends Game<DebugGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerDebug('secret', () => SECRET_VALUE);
    this.registerDebug('broken', () => {
      throw new Error('debug function failed');
    });
    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({
        maxIterations: 1000,
        do: actionStep({ actions: ['pass'], player: (ctx) => ctx.game.getPlayer(1)!, turnScope: 'restart' }),
      }),
    });
  }
}

const def: GameDefinitionLike = { gameClass: DebugGame, gameType: 'debug-panel-live', minPlayers: 2, maxPlayers: 2 };
const gameOptions = { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'debug-panel-live' };

function table() {
  return createHeadlessSession(def, gameOptions);
}

/** A live host with debugging off, as the platform runs it. */
function platformHost(): SnapshotSessionHost {
  return new SnapshotSessionHost({
    playerCount: 2,
    executeOp: (snap, pend, op) => executeOp(def, gameOptions, snap, pend, op),
    record: () => {},
    push: () => {},
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('registerDebug data on the live host (#547)', () => {
  it('answers the asking seat with the game\'s registered debug data', async () => {
    const session = table();
    await session.start();

    const result = await session.send(1, { type: 'debugCustomData', player: 1 });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.customDebug).toEqual({
      secret: SECRET_VALUE,
      broken: { error: 'debug function failed' },
    });
  });

  it('refuses a seat that asks for another seat\'s debug data', async () => {
    const session = table();
    await session.start();

    const result = await session.send(2, { type: 'debugCustomData', player: 1 });

    expect(result.success).toBe(false);
  });

  it('puts the data in no published view, before or after a seat asks', async () => {
    const session = table();
    await session.start();
    await session.send(1, { type: 'debugCustomData', player: 1 });
    await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} });

    for (const published of [...session.broadcasts, ...session.spectatorViews]) {
      expect(JSON.stringify(published)).not.toContain(SECRET_VALUE);
    }
  });

  it('refuses it on a host with debugging off, as on the platform', async () => {
    const host = platformHost();
    await host.start();

    const result = await host.handleOp(1, { type: 'debugCustomData', player: 1 });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);
  });

  it('is refused by the executor itself when the host passes no debug option', async () => {
    const started = await executeOp(def, gameOptions, null, null, { type: 'start' });
    if (!started.success) throw new Error(started.error);

    const result = await executeOp(def, gameOptions, started.snapshot, null, { type: 'debugCustomData', player: 1 });

    expect(result.success).toBe(false);
  });
});

describe('move arrival times on the live host (#547)', () => {
  async function passAt(session: ReturnType<typeof table>, time: number) {
    vi.setSystemTime(time);
    const result = await session.send(1, { type: 'action', actionName: 'pass', player: 1, args: {} });
    if (!result.success) throw new Error(result.error);
  }

  async function arrivalTimes(session: ReturnType<typeof table>): Promise<Array<number | undefined>> {
    const result = await session.send(1, { type: 'debugHistory' });
    if (!result.success) throw new Error(result.error);
    return result.actionHistory.map((entry) => entry.timestamp);
  }

  it('stamps each history entry with the time its move reached the host', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const session = table();
    await session.start();
    await passAt(session, 1_000);
    await passAt(session, 2_000);

    expect(await arrivalTimes(session)).toEqual([1_000, 2_000]);
  });

  it('keeps every wall-clock value out of the engine snapshot', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const session = table();
    await session.start();
    await passAt(session, 1_000);
    await passAt(session, 2_000);
    await session.send(1, { type: 'debugHistory' });

    const snapshot = session.host.snapshot!;
    expect(snapshot.actionHistory).toHaveLength(2);
    for (const entry of snapshot.actionHistory) expect(entry).not.toHaveProperty('timestamp');
  });

  it('drops the times of moves a rewind discarded, and stamps the moves made after it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const session = table();
    await session.start();
    await passAt(session, 1_000);
    await passAt(session, 2_000);
    await passAt(session, 3_000);

    const rewound = await session.send(1, { type: 'debugRewind', actionIndex: 1 });
    expect(rewound.success).toBe(true);
    await passAt(session, 4_000);

    expect(await arrivalTimes(session)).toEqual([1_000, 4_000]);
  });

  it('gives no time to a move made before this host held the game', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const session = table();
    await session.start();
    await passAt(session, 1_000);

    const restored = SnapshotSessionHost.restore(
      {
        playerCount: 2,
        debug: true,
        executeOp: (snap, pend, op) => executeOp(def, gameOptions, snap, pend, op, { debug: true }),
        record: () => {},
        push: () => {},
      },
      { snapshot: session.host.snapshot!, pendingStates: {}, botSeats: [] },
    );
    vi.setSystemTime(2_000);
    await restored.handleOp(1, { type: 'action', actionName: 'pass', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(restored) });

    const result = await restored.handleOp(1, { type: 'debugHistory' });
    if (!result.success) throw new Error(result.error);
    expect(result.actionHistory.map((entry) => entry.timestamp)).toEqual([undefined, 2_000]);
  });

  it('records no time for a move made while debugging is off', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let debug = false;
    const host = new SnapshotSessionHost({
      playerCount: 2,
      get debug() {
        return debug;
      },
      executeOp: (snap, pend, op) => executeOp(def, gameOptions, snap, pend, op, { debug }),
      record: () => {},
      push: () => {},
    });
    await host.start();
    vi.setSystemTime(1_000);
    await host.handleOp(1, { type: 'action', actionName: 'pass', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(host) });
    debug = true;
    vi.setSystemTime(2_000);
    await host.handleOp(1, { type: 'action', actionName: 'pass', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(host) });

    const result = await host.handleOp(1, { type: 'debugHistory' });
    if (!result.success) throw new Error(result.error);
    expect(result.actionHistory.map((entry) => entry.timestamp)).toEqual([undefined, 2_000]);
  });
});
