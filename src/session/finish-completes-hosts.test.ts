/**
 * Every host reports a game finished inside a non-turnLoop flow as complete
 * (#492).
 *
 * Hosts read `isComplete` from the flow and `winners` from the game. A game
 * that called `this.finish([p])` inside an `eachPlayer` turn used to leave the
 * flow waiting on the next seat, so the stateless op result, the snapshot
 * host's broadcast all
 * said "not complete" beside a winner, and the next seat was still offered its
 * turn.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, defineFlow, eachPlayer, actionStep, type GameOptions } from '../engine/index.js';
import { executeOp, type GameDefinitionLike } from './stateless-ops.js';
import { SnapshotSessionHost, type SnapshotSessionAdapters, type PublishMeta } from './snapshot-session-host.js';
import { boundaryKeyOf, boundaryKeyOfHost } from './testing/boundary-stamp.js';
import { succeeded } from './op-result.test-helper.js';

class FinishInTurnGame extends Game<FinishInTurnGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerActions(
      Action.create<FinishInTurnGame>('pass').prompt('Pass').execute(() => {}),
      Action.create<FinishInTurnGame>('win').prompt('Win').execute((_a, ctx) => {
        ctx.game.finish([ctx.player]);
      }),
    );
    this.setFlow(
      defineFlow({
        root: eachPlayer({ do: actionStep({ actions: ['pass', 'win'], turnScope: 'restart' }) }),
      }),
    );
  }
}

const gameDef: GameDefinitionLike = {
  gameClass: FinishInTurnGame,
  gameType: 'finish-in-turn',
  minPlayers: 2,
  maxPlayers: 3,
};
const options = { playerCount: 3, seed: 'finish-in-turn' };

describe('stateless ops', () => {
  it('the action op that finishes the game reports it complete with its winner', async () => {
    const started = succeeded(await executeOp(gameDef, options, null, {}, { type: 'start' }));
    expect(started.snapshot.flowState?.complete).toBe(false);

    const res = succeeded(await executeOp(gameDef, options, started.snapshot, null, {
      type: 'action', actionName: 'win', player: 1, args: {}, boundaryKey: boundaryKeyOf(started.snapshot),
    }));

    expect(res.success).toBe(true);
    expect(res.snapshot.flowState?.complete).toBe(true);
    expect(res.snapshot.winners).toEqual([1]);
  });

  it('refuses the next seat an action on the finished game', async () => {
    const started = succeeded(await executeOp(gameDef, options, null, {}, { type: 'start' }));
    const finished = succeeded(await executeOp(gameDef, options, started.snapshot, null, {
      type: 'action', actionName: 'win', player: 1, args: {}, boundaryKey: boundaryKeyOf(started.snapshot),
    }));

    const next = await executeOp(gameDef, options, finished.snapshot, null, {
      type: 'action', actionName: 'pass', player: 2, args: {}, boundaryKey: boundaryKeyOf(finished.snapshot),
    });

    expect(next.success).toBe(false);
  });
});

describe('SnapshotSessionHost', () => {
  it('broadcasts the finished game as complete, decisive, and offers no seat a turn', async () => {
    const records: Array<[unknown[], PublishMeta]> = [];
    const adapters: SnapshotSessionAdapters = {
      playerCount: 3,
      executeOp: (snap, pend, op) => executeOp(gameDef, options, snap, pend, op),
      push: () => {},
      record: ({ players: views }, meta) => records.push([views, meta]),
    };
    const host = new SnapshotSessionHost(adapters);
    await host.start();

    await host.handleOp(1, {
      type: 'action', actionName: 'win', player: 1, args: {}, boundaryKey: boundaryKeyOfHost(host),
    });

    expect(host.isComplete).toBe(true);
    const [views, meta] = records[records.length - 1];
    expect(meta).toMatchObject({ isComplete: true, winners: [1], isDraw: false });
    expect(views).toHaveLength(3);
    for (const view of views as Array<{ state: { isMyTurn: boolean; availableActions: string[] } }>) {
      expect(view.state.isMyTurn).toBe(false);
      expect(view.state.availableActions).toEqual([]);
    }
    const next = await host.handleOp(2, {
      type: 'action', actionName: 'pass', player: 2, args: {}, boundaryKey: boundaryKeyOfHost(host),
    });
    expect(next.success).toBe(false);
  });
});
