/**
 * A game's lobby-built constructor options (`playerConfigs`) reach every game
 * the live host rebuilds, including after the host itself is restored.
 *
 * A host hands `playerConfigs` to the game only on the `start` op (the dev host
 * and the platform build it from their lobby); every later op rebuilds the game
 * from the snapshot. So constructor-time logic that reads `playerConfigs` (a
 * role such as MERC's dictator, a per-seat bot flag) must find them in the
 * snapshot's own constructor options, or the rebuilt game silently diverges
 * from the one that started: after a process restart, and on every op.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Game, defineFlow, actionStep, loop, Action, type GameOptions } from '../engine/index.js';
import { executeOp, runnerFromSnapshot, type GameDefinitionLike } from './stateless-ops.js';
import { SnapshotSessionHost, type SnapshotSessionAdapters } from './snapshot-session-host.js';
import { boundaryKeyOfHost } from './testing/boundary-stamp.js';
import type { PlayerConfig } from './types.js';

// What the most recently built game's constructor received.
let capturedPlayerConfigs: PlayerConfig[] | undefined;

class RestoreTestGame extends Game {
  leaderSeat: number = -1;

  constructor(options: GameOptions & { playerConfigs?: PlayerConfig[] }) {
    super(options);
    capturedPlayerConfigs = options.playerConfigs;

    const leader = options.playerConfigs?.find((c) => c.isDictator === true);
    if (leader) this.leaderSeat = options.playerConfigs!.indexOf(leader) + 1;

    this.registerAction(Action.create('pass').execute(() => ({ success: true })));
    this.setFlow(defineFlow({ root: loop({ maxIterations: 100, do: actionStep({ actions: ['pass'], turnScope: 'restart' }) }) }));
  }
}

const def = {
  gameClass: RestoreTestGame,
  gameType: 'restore-test',
  minPlayers: 3,
  maxPlayers: 3,
} satisfies GameDefinitionLike;

const playerConfigs: PlayerConfig[] = [
  { name: 'Alice', isDictator: false },
  { name: 'Bob', isDictator: false },
  { name: 'Charlie', isDictator: true },
];

/** Adapters the way a host builds them: lobby options on `start`, the bare seat count after. */
function adapters(): SnapshotSessionAdapters {
  const startOptions = { playerCount: 3, seed: 'restore-configs', playerNames: ['Alice', 'Bob', 'Charlie'], playerConfigs };
  return {
    playerCount: 3,
    executeOp: (snap, pend, op) => executeOp(def, op.type === 'start' ? startOptions : { playerCount: 3 }, snap, pend, op),
    record: () => {},
    push: () => {},
  };
}

function pass(host: SnapshotSessionHost) {
  return host.handleOp(1, { type: 'action', actionName: 'pass', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(host) });
}

describe('playerConfigs survive every rebuild of the game, including a restored host', () => {
  beforeEach(() => {
    capturedPlayerConfigs = undefined;
  });

  it('a game rebuilt after start, and after a restore from JSON, is constructed with the start playerConfigs', async () => {
    const host = new SnapshotSessionHost(adapters());
    await host.start();
    expect(capturedPlayerConfigs).toEqual(playerConfigs);

    // An op after start rebuilds the game from the snapshot alone.
    capturedPlayerConfigs = undefined;
    expect((await pass(host)).success).toBe(true);
    expect(capturedPlayerConfigs).toEqual(playerConfigs);

    // A fresh process restores from what storage handed back, then plays on.
    const stored = JSON.parse(JSON.stringify(host.durableState()));
    const restored = SnapshotSessionHost.restore(adapters(), { ...stored, botSeats: [] });
    capturedPlayerConfigs = undefined;
    expect((await pass(restored)).success).toBe(true);
    expect(capturedPlayerConfigs).toEqual(playerConfigs);

    const game = runnerFromSnapshot(restored.snapshot!, { ...def, randomness: 'allowed' }).game as RestoreTestGame;
    expect(game.leaderSeat).toBe(3);
    expect(game.getConstructorOptions().playerConfigs).toEqual(playerConfigs);
  });
});
